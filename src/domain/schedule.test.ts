import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import type { ActiveWindow } from "./active-window.js";
import { nextFireAt, firesDueAt } from "./schedule.js";

const window: ActiveWindow = { startMinutes: 9 * 60, endMinutes: 18 * 60 };
const intervalMinutes = 20;
const zone = "UTC";

function at(isoLocal: string): DateTime {
  return DateTime.fromISO(isoLocal, { zone });
}

describe("Reminder schedule grid", () => {
  it("aligns fires from Active Window open every Interval", () => {
    // 09:00, 09:20, 09:40 … last must still be inside window
    const now = at("2026-03-15T08:00:00");
    const next = nextFireAt({
      now,
      window,
      intervalMinutes,
      zone,
    });
    expect(next?.toISO()).toBe(at("2026-03-15T09:00:00").toISO());
  });

  it("returns next slot after now inside today's window", () => {
    const now = at("2026-03-15T09:05:00");
    const next = nextFireAt({
      now,
      window,
      intervalMinutes,
      zone,
    });
    expect(next?.toISO()).toBe(at("2026-03-15T09:20:00").toISO());
  });

  it("does not fire at or after window end", () => {
    // 17:40 is last 20m slot before 18:00; 18:00 is outside
    const now = at("2026-03-15T17:41:00");
    const next = nextFireAt({
      now,
      window,
      intervalMinutes,
      zone,
    });
    // next is tomorrow 09:00
    expect(next?.toISO()).toBe(at("2026-03-16T09:00:00").toISO());
  });

  it("firesDueAt is true only on exact grid instants inside window", () => {
    expect(
      firesDueAt({
        now: at("2026-03-15T09:00:00"),
        window,
        intervalMinutes,
        zone,
      }),
    ).toBe(true);
    expect(
      firesDueAt({
        now: at("2026-03-15T09:20:00"),
        window,
        intervalMinutes,
        zone,
      }),
    ).toBe(true);
    expect(
      firesDueAt({
        now: at("2026-03-15T09:10:00"),
        window,
        intervalMinutes,
        zone,
      }),
    ).toBe(false);
    expect(
      firesDueAt({
        now: at("2026-03-15T18:00:00"),
        window,
        intervalMinutes,
        zone,
      }),
    ).toBe(false);
  });

  it("uses IANA timezone for local window", () => {
    // 09:00 Asia/Jakarta = 02:00 UTC
    const now = DateTime.fromISO("2026-03-15T01:00:00", { zone: "UTC" });
    const next = nextFireAt({
      now,
      window,
      intervalMinutes,
      zone: "Asia/Jakarta",
    });
    expect(next?.setZone("UTC").toISO()).toBe(
      DateTime.fromISO("2026-03-15T02:00:00", { zone: "UTC" }).toISO(),
    );
  });
});
