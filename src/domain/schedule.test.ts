import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import type { ActiveWindow } from "./active-window.js";
import { NO_WINDOW } from "./active-window.js";
import {
  nextFireAt,
  firesDueAt,
  reminderDueAt,
  snoozeTargetIso,
} from "./schedule.js";

const window: ActiveWindow = { startMinutes: 9 * 60, endMinutes: 18 * 60 };
const intervalMinutes = 20;
const zone = "UTC";

function at(isoLocal: string): DateTime {
  return DateTime.fromISO(isoLocal, { zone });
}

function utcIso(isoLocal: string): string {
  return at(isoLocal).toUTC().toISO()!;
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

describe("Weekend Active Window", () => {
  // Weekday window excludes 10:00; weekend window excludes 11:00+.
  const weekday: ActiveWindow = { startMinutes: 11 * 60, endMinutes: 18 * 60 };
  const weekend: ActiveWindow = { startMinutes: 10 * 60, endMinutes: 14 * 60 };
  // 2026-03-14 is a Saturday; 2026-03-11 a Wednesday.
  const sat = (t: string) => at(`2026-03-14T${t}`);
  const wed = (t: string) => at(`2026-03-11T${t}`);

  it("firesDueAt uses the weekend window on Saturday", () => {
    expect(
      firesDueAt({
        now: sat("10:00:00"),
        window: weekday,
        weekendWindow: weekend,
        intervalMinutes: 60,
        zone,
      }),
    ).toBe(true);
    // 15:00 is inside the weekday window but Saturday ignores it.
    expect(
      firesDueAt({
        now: sat("15:00:00"),
        window: weekday,
        weekendWindow: weekend,
        intervalMinutes: 60,
        zone,
      }),
    ).toBe(false);
  });

  it("firesDueAt uses the weekday window on Wednesday", () => {
    expect(
      firesDueAt({
        now: wed("11:00:00"),
        window: weekday,
        weekendWindow: weekend,
        intervalMinutes: 60,
        zone,
      }),
    ).toBe(true);
    // 10:00 is inside the weekend window but Wednesday ignores it.
    expect(
      firesDueAt({
        now: wed("10:00:00"),
        window: weekday,
        weekendWindow: weekend,
        intervalMinutes: 60,
        zone,
      }),
    ).toBe(false);
  });

  it("nextFireAt skips a weekend whose sentinel window is empty and lands on Monday's first slot", () => {
    const next = nextFireAt({
      now: sat("09:00:00"),
      window: { startMinutes: 9 * 60, endMinutes: 18 * 60 },
      weekendWindow: NO_WINDOW,
      intervalMinutes: 20,
      zone,
    });
    expect(next?.toISO()).toBe(at("2026-03-16T09:00:00").toISO());
  });

  it("snoozeTargetIso checks containment against the weekend window on a Saturday target", () => {
    // 13:56 Sat + 5 min = 14:01, outside the weekend window 10:00–14:00
    // even though the weekday window would allow it.
    expect(
      snoozeTargetIso({
        now: sat("13:56:00"),
        snoozeMinutes: 5,
        window: weekday,
        weekendWindow: weekend,
        zone,
      }),
    ).toBeNull();
    expect(
      snoozeTargetIso({
        now: sat("12:56:00"),
        snoozeMinutes: 5,
        window: weekday,
        weekendWindow: weekend,
        zone,
      }),
    ).toBe(utcIso("2026-03-14T13:01:00"));
  });
});

describe("Snooze and Reminder due", () => {
  it("snoozeTargetIso is now + offset when still inside Active Window", () => {
    const target = snoozeTargetIso({
      now: at("2026-03-15T10:00:00"),
      snoozeMinutes: 5,
      window,
      zone,
    });
    expect(target).toBe(utcIso("2026-03-15T10:05:00"));
  });

  it("snoozeTargetIso is null when delayed fire would be outside Active Window", () => {
    const target = snoozeTargetIso({
      now: at("2026-03-15T17:56:00"),
      snoozeMinutes: 5,
      window,
      zone,
    });
    expect(target).toBeNull();
  });

  it("reminderDueAt follows grid when no Snooze pending", () => {
    expect(
      reminderDueAt({
        now: at("2026-03-15T09:00:00"),
        window,
        intervalMinutes,
        zone,
        snoozeUntilIso: null,
        lastFireIso: null,
      }),
    ).toEqual({
      due: true,
      fireIso: utcIso("2026-03-15T09:00:00"),
      clearSnooze: false,
    });
    expect(
      reminderDueAt({
        now: at("2026-03-15T09:10:00"),
        window,
        intervalMinutes,
        zone,
        snoozeUntilIso: null,
        lastFireIso: null,
      }).due,
    ).toBe(false);
  });

  it("pending Snooze suppresses grid fires before the delayed time", () => {
    const result = reminderDueAt({
      now: at("2026-03-15T09:20:00"),
      window,
      intervalMinutes,
      zone,
      snoozeUntilIso: utcIso("2026-03-15T09:25:00"),
      lastFireIso: utcIso("2026-03-15T09:00:00"),
    });
    expect(result).toEqual({ due: false, clearSnooze: false });
  });

  it("fires at Snooze time and clears Snooze", () => {
    const result = reminderDueAt({
      now: at("2026-03-15T09:25:00"),
      window,
      intervalMinutes,
      zone,
      snoozeUntilIso: utcIso("2026-03-15T09:25:00"),
      lastFireIso: utcIso("2026-03-15T09:00:00"),
    });
    expect(result).toEqual({
      due: true,
      fireIso: utcIso("2026-03-15T09:25:00"),
      clearSnooze: true,
    });
  });

  it("drops Snooze without firing when delayed time is outside Active Window", () => {
    const result = reminderDueAt({
      now: at("2026-03-15T18:00:00"),
      window,
      intervalMinutes,
      zone,
      snoozeUntilIso: utcIso("2026-03-15T18:00:00"),
      lastFireIso: utcIso("2026-03-15T17:40:00"),
    });
    expect(result).toEqual({ due: false, clearSnooze: true });
  });

  it("does not double-fire the same minute", () => {
    const result = reminderDueAt({
      now: at("2026-03-15T09:00:00"),
      window,
      intervalMinutes,
      zone,
      snoozeUntilIso: null,
      lastFireIso: utcIso("2026-03-15T09:00:00"),
    });
    expect(result.due).toBe(false);
  });

  it("drops stale Snooze on a later calendar day without firing", () => {
    const result = reminderDueAt({
      now: at("2026-03-16T09:00:00"),
      window,
      intervalMinutes,
      zone,
      snoozeUntilIso: utcIso("2026-03-15T17:55:00"),
      lastFireIso: utcIso("2026-03-15T17:40:00"),
    });
    expect(result).toEqual({ due: false, clearSnooze: true });
  });
});
