import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UserStore } from "./user-store.js";
import { EYE_REST_ACTIVITY_ID } from "../domain/activities.js";

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

  it("completes setup with Timezone and Active Window and turns Eye Rest on", () => {
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
