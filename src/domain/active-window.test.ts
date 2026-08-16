import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  NO_WINDOW,
  effectiveWindow,
  parseActiveWindow,
  windowContains,
  type ActiveWindow,
} from "./active-window.js";

describe("Active Window validation", () => {
  it("accepts same-day window with end after start", () => {
    const result = parseActiveWindow("09:00", "18:00");
    expect(result).toEqual({
      ok: true,
      window: { startMinutes: 9 * 60, endMinutes: 18 * 60 },
    });
  });

  it("accepts full day 00:00–23:59", () => {
    const result = parseActiveWindow("00:00", "23:59");
    expect(result).toEqual({
      ok: true,
      window: { startMinutes: 0, endMinutes: 23 * 60 + 59 },
    });
  });

  it("rejects overnight window (end before start)", () => {
    const result = parseActiveWindow("22:00", "06:00");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/midnight|same day|after start/i);
    }
  });

  it("rejects end equal to start", () => {
    const result = parseActiveWindow("09:00", "09:00");
    expect(result.ok).toBe(false);
  });

  it("rejects invalid time format", () => {
    expect(parseActiveWindow("9:00", "18:00").ok).toBe(false);
    expect(parseActiveWindow("09:00", "25:00").ok).toBe(false);
    expect(parseActiveWindow("abc", "18:00").ok).toBe(false);
  });

  it("exposes contains for minutes-from-midnight", () => {
    const window: ActiveWindow = { startMinutes: 9 * 60, endMinutes: 18 * 60 };
    expect(windowContains(window, 9 * 60)).toBe(true);
    expect(windowContains(window, 12 * 60)).toBe(true);
    expect(windowContains(window, 18 * 60)).toBe(false);
    expect(windowContains(window, 8 * 60 + 59)).toBe(false);
  });

  it("never matches the zero-length NO_WINDOW sentinel", () => {
    expect(windowContains(NO_WINDOW, 0)).toBe(false);
    expect(windowContains(NO_WINDOW, 12 * 60)).toBe(false);
    expect(windowContains(NO_WINDOW, 23 * 60 + 59)).toBe(false);
  });
});

describe("effectiveWindow", () => {
  const weekday: ActiveWindow = { startMinutes: 9 * 60, endMinutes: 18 * 60 };
  const weekend: ActiveWindow = { startMinutes: 10 * 60, endMinutes: 14 * 60 };

  // 2026-03-14 is a Saturday, 03-15 a Sunday, 03-16 a Monday.
  const sat = DateTime.fromISO("2026-03-14T10:00:00", { zone: "UTC" });
  const sun = DateTime.fromISO("2026-03-15T10:00:00", { zone: "UTC" });
  const mon = DateTime.fromISO("2026-03-16T10:00:00", { zone: "UTC" });

  it("null weekend means the weekday window every day", () => {
    expect(effectiveWindow(weekday, null, sat)).toEqual(weekday);
    expect(effectiveWindow(weekday, null, sun)).toEqual(weekday);
    expect(effectiveWindow(weekday, null, mon)).toEqual(weekday);
  });

  it("set weekend applies on Saturday and Sunday, weekday window on Monday", () => {
    expect(sat.weekday).toBe(6);
    expect(sun.weekday).toBe(7);
    expect(mon.weekday).toBe(1);
    expect(effectiveWindow(weekday, weekend, sat)).toEqual(weekend);
    expect(effectiveWindow(weekday, weekend, sun)).toEqual(weekend);
    expect(effectiveWindow(weekday, weekend, mon)).toEqual(weekday);
  });

  it("derives the weekday from the User's local calendar day (DST-safe zone)", () => {
    // 2026-03-14 23:00 UTC is already Sunday 06:00 in Jakarta.
    const localSun = DateTime.fromISO("2026-03-14T23:00:00", {
      zone: "UTC",
    }).setZone("Asia/Jakarta");
    expect(localSun.weekday).toBe(7);
    expect(effectiveWindow(weekday, weekend, localSun)).toEqual(weekend);
  });

  it("returns the {0,0} off-sentinel unchanged on weekend days", () => {
    expect(effectiveWindow(weekday, NO_WINDOW, sat)).toEqual(NO_WINDOW);
    expect(effectiveWindow(weekday, NO_WINDOW, mon)).toEqual(weekday);
  });
});
