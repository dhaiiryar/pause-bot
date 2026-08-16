import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { UserStore } from "./user-store.js";
import {
  ACTIVITY_IDS,
  EYE_REST_ACTIVITY_ID,
  STRETCH_ACTIVITY_ID,
} from "../domain/activities.js";

describe("User settings store", () => {
  let dir: string;
  let store: UserStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pause-bot-"));
    store = UserStore.open(join(dir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a User on first touch and is not setup until window+timezone set", () => {
    const user = store.ensureUser(42, 100);
    expect(user.telegramUserId).toBe(42);
    expect(user.chatId).toBe(100);
    expect(user.setupComplete).toBe(false);
    expect(user.timezone).toBeNull();
    expect(user.activeWindow).toBeNull();
  });

  it("seeds every Activity with its defaults on first touch", () => {
    const user = store.ensureUser(42, 100);
    expect(Object.keys(user.activities).sort()).toEqual(
      [...ACTIVITY_IDS].sort(),
    );
    expect(user.activities[EYE_REST_ACTIVITY_ID].on).toBe(false);
    expect(user.activities[EYE_REST_ACTIVITY_ID].intervalMinutes).toBe(20);
    expect(user.activities[STRETCH_ACTIVITY_ID].on).toBe(false);
    expect(user.activities[STRETCH_ACTIVITY_ID].intervalMinutes).toBe(60);
  });

  it("completes setup with Timezone and Active Window and turns every Activity on", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "Asia/Jakarta");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const user = store.getUser(1);
    expect(user?.setupComplete).toBe(true);
    expect(user?.timezone).toBe("Asia/Jakarta");
    expect(user?.activeWindow).toEqual({
      startMinutes: 9 * 60,
      endMinutes: 18 * 60,
    });
    expect(user?.activities[EYE_REST_ACTIVITY_ID].on).toBe(true);
    expect(user?.activities[EYE_REST_ACTIVITY_ID].intervalMinutes).toBe(20);
    expect(user?.activities[STRETCH_ACTIVITY_ID].on).toBe(true);
    expect(user?.activities[STRETCH_ACTIVITY_ID].intervalMinutes).toBe(60);
  });

  it("backfills an off row for an Activity added after the User existed", () => {
    store.ensureUser(1, 10);
    store.close();
    // Simulate a pre-migration database: the new Activity has no row yet.
    const external = new Database(join(dir, "test.db"));
    external
      .prepare(`DELETE FROM user_activities WHERE activity_id = ?`)
      .run(STRETCH_ACTIVITY_ID);
    external.close();
    store = UserStore.open(join(dir, "test.db"));
    const raw = new Database(join(dir, "test.db"), { readonly: true });
    try {
      const row = raw
        .prepare(
          `SELECT is_on, interval_minutes FROM user_activities
           WHERE telegram_user_id = 1 AND activity_id = ?`,
        )
        .get(STRETCH_ACTIVITY_ID) as { is_on: number; interval_minutes: number };
      expect(row.is_on).toBe(0);
      expect(row.interval_minutes).toBe(60);
    } finally {
      raw.close();
    }
    // The backfilled row makes setActivityOn actually persist.
    store.setActivityOn(1, STRETCH_ACTIVITY_ID, true);
    expect(store.getUser(1)?.activities[STRETCH_ACTIVITY_ID].on).toBe(true);
  });

  it("persists a User-set Interval", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setIntervalMinutes(1, EYE_REST_ACTIVITY_ID, 45);
    expect(
      store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].intervalMinutes,
    ).toBe(45);
  });

  it("turns Activity off and on without wiping settings", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setActivityOn(1, EYE_REST_ACTIVITY_ID, false);
    let user = store.getUser(1)!;
    expect(user.activities[EYE_REST_ACTIVITY_ID].on).toBe(false);
    expect(user.timezone).toBe("UTC");
    store.setActivityOn(1, EYE_REST_ACTIVITY_ID, true);
    user = store.getUser(1)!;
    expect(user.activities[EYE_REST_ACTIVITY_ID].on).toBe(true);
  });

  it("wipes User data completely", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.deleteUser(1);
    expect(store.getUser(1)).toBeNull();
  });

  it("updates chat id on ensureUser", () => {
    store.ensureUser(1, 10);
    store.ensureUser(1, 99);
    expect(store.getUser(1)?.chatId).toBe(99);
  });

  it("lists Users with an Activity on and setup complete for scheduling", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });

    store.ensureUser(2, 20);
    store.setTimezone(2, "UTC");
    store.setActiveWindow(2, { startMinutes: 10 * 60, endMinutes: 17 * 60 });
    store.setActivityOn(2, EYE_REST_ACTIVITY_ID, false);

    store.ensureUser(3, 30); // incomplete setup

    const due = store.listSchedulable(EYE_REST_ACTIVITY_ID);
    expect(due.map((u) => u.telegramUserId).sort()).toEqual([1]);
  });

  it("records last fire minute so scheduler can avoid double-send", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setLastFireIso(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:00:00.000Z");
    expect(store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].lastFireIso).toBe(
      "2026-03-15T09:00:00.000Z",
    );
  });

  it("does not re-enable Eye Rest when Active Window changes after user turned it off", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setActivityOn(1, EYE_REST_ACTIVITY_ID, false);
    store.setActiveWindow(1, { startMinutes: 10 * 60, endMinutes: 16 * 60 });
    expect(store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].on).toBe(false);
  });

  it("persists Snooze until and latest Reminder message id", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setSnoozeUntilIso(
      1,
      EYE_REST_ACTIVITY_ID,
      "2026-03-15T09:25:00.000Z",
    );
    store.setLatestReminderMessageId(1, EYE_REST_ACTIVITY_ID, 42);
    const activity = store.getUser(1)!.activities[EYE_REST_ACTIVITY_ID];
    expect(activity.snoozeUntilIso).toBe("2026-03-15T09:25:00.000Z");
    expect(activity.latestReminderMessageId).toBe(42);
  });

  it("clears pending Snooze when Activity is turned off", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setSnoozeUntilIso(
      1,
      EYE_REST_ACTIVITY_ID,
      "2026-03-15T09:25:00.000Z",
    );
    store.setActivityOn(1, EYE_REST_ACTIVITY_ID, false);
    expect(
      store.getUser(1)!.activities[EYE_REST_ACTIVITY_ID].snoozeUntilIso,
    ).toBeNull();
  });

  it("clears pending Snooze when Active Window changes", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setSnoozeUntilIso(
      1,
      EYE_REST_ACTIVITY_ID,
      "2026-03-15T09:25:00.000Z",
    );
    store.setActiveWindow(1, { startMinutes: 10 * 60, endMinutes: 16 * 60 });
    expect(
      store.getUser(1)!.activities[EYE_REST_ACTIVITY_ID].snoozeUntilIso,
    ).toBeNull();
  });

  it("round-trips Reminder events since a cutoff", () => {
    store.ensureUser(1, 10);
    store.recordReminderFired(1, EYE_REST_ACTIVITY_ID, "2026-03-09T09:00:00.000Z");
    store.recordReminderFired(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:00:00.000Z");
    store.recordReminderFired(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:20:00.000Z");
    const events = store.listReminderEvents(
      1,
      EYE_REST_ACTIVITY_ID,
      "2026-03-10T00:00:00.000Z",
    );
    expect(events).toEqual([
      { fireIso: "2026-03-15T09:00:00.000Z", action: null },
      { fireIso: "2026-03-15T09:20:00.000Z", action: null },
    ]);
  });

  it("records a Done action on the fired Reminder event", () => {
    store.ensureUser(1, 10);
    store.recordReminderFired(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:00:00.000Z");
    store.recordReminderAction(
      1,
      EYE_REST_ACTIVITY_ID,
      "2026-03-15T09:00:00.000Z",
      "done",
      "2026-03-15T09:01:00.000Z",
    );
    expect(
      store.listReminderEvents(1, EYE_REST_ACTIVITY_ID, "2026-01-01T00:00:00.000Z"),
    ).toEqual([
      { fireIso: "2026-03-15T09:00:00.000Z", action: "done" },
    ]);
    // listReminderEvents does not expose acted_at_iso; read the column directly.
    const raw = new Database(join(dir, "test.db"), { readonly: true });
    try {
      const row = raw
        .prepare(
          `SELECT action, acted_at_iso FROM reminder_events WHERE fire_iso = ?`,
        )
        .get("2026-03-15T09:00:00.000Z") as {
        action: string;
        acted_at_iso: string;
      };
      expect(row.action).toBe("done");
      expect(row.acted_at_iso).toBe("2026-03-15T09:01:00.000Z");
    } finally {
      raw.close();
    }
  });

  it("still records an action when no fired row exists (pre-events Reminder)", () => {
    store.ensureUser(1, 10);
    store.recordReminderAction(
      1,
      EYE_REST_ACTIVITY_ID,
      "2026-03-15T09:00:00.000Z",
      "snoozed",
      "2026-03-15T09:01:00.000Z",
    );
    expect(
      store.listReminderEvents(1, EYE_REST_ACTIVITY_ID, "2026-01-01T00:00:00.000Z"),
    ).toEqual([
      { fireIso: "2026-03-15T09:00:00.000Z", action: "snoozed" },
    ]);
  });

  it("wipes Reminder events on delete via cascade", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.recordReminderFired(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:00:00.000Z");
    store.deleteUser(1);
    expect(
      store.listReminderEvents(1, EYE_REST_ACTIVITY_ID, "2026-01-01T00:00:00.000Z"),
    ).toEqual([]);
  });

  it("clears pending Snooze when Timezone changes", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setSnoozeUntilIso(
      1,
      EYE_REST_ACTIVITY_ID,
      "2026-03-15T09:25:00.000Z",
    );
    store.setTimezone(1, "Asia/Jakarta");
    expect(
      store.getUser(1)!.activities[EYE_REST_ACTIVITY_ID].snoozeUntilIso,
    ).toBeNull();
  });
});
