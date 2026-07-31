import { describe, expect, it } from "vitest";
import {
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
});
