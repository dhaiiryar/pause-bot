import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  computeAdherenceStats,
  formatAdherence,
  type ReminderEventRow,
} from "./stats.js";

const ZONE = "Asia/Jakarta";

function at(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: "utc" });
}

describe("Adherence stats", () => {
  it("returns all-zero stats for no events", () => {
    const stats = computeAdherenceStats({
      events: [],
      now: at("2026-03-16T02:00:00Z"),
      zone: ZONE,
    });
    expect(stats).toEqual({
      todayFires: 0,
      todayDone: 0,
      weekFires: 0,
      weekDone: 0,
      weekSnoozed: 0,
      streak: 0,
    });
  });

  it("buckets fires by local day across a local-midnight boundary", () => {
    // Jakarta is UTC+7: 2026-03-15T17:30Z is already March 16 locally.
    const events: ReminderEventRow[] = [
      { fireIso: "2026-03-16T00:30:00.000Z", action: "done" },
      { fireIso: "2026-03-15T17:30:00.000Z", action: "done" },
      { fireIso: "2026-03-15T10:00:00.000Z", action: "snoozed" },
      { fireIso: "2026-03-08T02:00:00.000Z", action: "done" }, // 8 local days ago: outside the week
    ];
    const stats = computeAdherenceStats({
      events,
      now: at("2026-03-16T02:00:00Z"), // 09:00 local on March 16
      zone: ZONE,
    });
    expect(stats.todayFires).toBe(2);
    expect(stats.todayDone).toBe(2);
    expect(stats.weekFires).toBe(3);
    expect(stats.weekDone).toBe(2);
    expect(stats.weekSnoozed).toBe(1);
  });

  it("counts the streak as the leading run of Done fires, newest first", () => {
    const events: ReminderEventRow[] = [
      { fireIso: "2026-03-16T00:20:00.000Z", action: "done" },
      { fireIso: "2026-03-16T00:00:00.000Z", action: "done" },
      { fireIso: "2026-03-15T23:40:00.000Z", action: "done" },
      { fireIso: "2026-03-15T23:20:00.000Z", action: "snoozed" },
      { fireIso: "2026-03-15T23:00:00.000Z", action: "done" },
    ];
    const stats = computeAdherenceStats({
      events,
      now: at("2026-03-16T02:00:00Z"),
      zone: ZONE,
    });
    expect(stats.streak).toBe(3);
  });

  it("breaks the streak on an unacted fire", () => {
    const events: ReminderEventRow[] = [
      { fireIso: "2026-03-16T00:20:00.000Z", action: null },
      { fireIso: "2026-03-16T00:00:00.000Z", action: "done" },
    ];
    const stats = computeAdherenceStats({
      events,
      now: at("2026-03-16T02:00:00Z"),
      zone: ZONE,
    });
    expect(stats.streak).toBe(0);
  });
});

describe("Adherence formatting", () => {
  it("says no Reminders yet when nothing fired", () => {
    const text = formatAdherence("Eye Rest", {
      todayFires: 0,
      todayDone: 0,
      weekFires: 0,
      weekDone: 0,
      weekSnoozed: 0,
      streak: 0,
    });
    expect(text).toContain("Today: no Reminders yet");
    expect(text).toContain("Last 7 days: no Reminders yet");
    expect(text).toContain("Streak: 0 Done in a row");
  });

  it("uses singular for one Reminder and plural with percentage otherwise", () => {
    const singular = formatAdherence("Eye Rest", {
      todayFires: 1,
      todayDone: 1,
      weekFires: 1,
      weekDone: 1,
      weekSnoozed: 0,
      streak: 1,
    });
    expect(singular).toContain("Today: 1 Reminder, 1 Done (100%)");
    expect(singular).toContain("Last 7 days: 1 Reminder, 1 Done (100%), 0 Snoozed");

    const plural = formatAdherence("Eye Rest", {
      todayFires: 3,
      todayDone: 2,
      weekFires: 10,
      weekDone: 5,
      weekSnoozed: 2,
      streak: 4,
    });
    expect(plural).toContain("Today: 3 Reminders, 2 Done (67%)");
    expect(plural).toContain("Last 7 days: 10 Reminders, 5 Done (50%), 2 Snoozed");
    expect(plural).toContain("Streak: 4 Done in a row");
    expect(plural).toContain("Eye Rest stats");
  });

  it("shows an em dash instead of a percentage when a period had no fires", () => {
    const text = formatAdherence("Eye Rest", {
      todayFires: 0,
      todayDone: 0,
      weekFires: 2,
      weekDone: 0,
      weekSnoozed: 1,
      streak: 0,
    });
    expect(text).toContain("Today: no Reminders yet");
    expect(text).toContain("Last 7 days: 2 Reminders, 0 Done (0%), 1 Snoozed");
  });
});
