import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DateTime } from "luxon";
import { UserStore } from "../store/user-store.js";
import { BotApp, formatStatus, parseActivityScope } from "./app.js";
import {
  EYE_REST_ACTIVITY_ID,
  STRETCH_ACTIVITY_ID,
} from "../domain/activities.js";

describe("Bot app intents", () => {
  let dir: string;
  let store: UserStore;
  let app: BotApp;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pause-bot-app-"));
    store = UserStore.open(join(dir, "test.db"));
    app = new BotApp(store, () =>
      DateTime.fromISO("2026-03-15T10:00:00", { zone: "utc" }),
    );
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects group chats", () => {
    const result = app.onStart({
      telegramUserId: 1,
      chatId: -100123,
      chatType: "group",
    });
    expect(result.kind).toBe("private_only");
  });

  it("starts setup for new private User", () => {
    const result = app.onStart({
      telegramUserId: 1,
      chatId: 10,
      chatType: "private",
    });
    expect(result.kind).toBe("setup_timezone");
    expect(store.getUser(1)?.setupComplete).toBe(false);
  });

  it("shows status when already set up", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const result = app.onStart({
      telegramUserId: 1,
      chatId: 10,
      chatType: "private",
    });
    expect(result.kind).toBe("status");
    if (result.kind === "status") {
      expect(result.user.setupComplete).toBe(true);
      expect(result.user.activities[EYE_REST_ACTIVITY_ID].on).toBe(true);
    }
  });

  it("sets timezone then asks for Active Window", () => {
    store.ensureUser(1, 10);
    const result = app.setTimezone(1, "Asia/Jakarta");
    expect(result.kind).toBe("setup_window");
    expect(store.getUser(1)?.timezone).toBe("Asia/Jakarta");
  });

  it("rejects invalid timezone", () => {
    store.ensureUser(1, 10);
    const result = app.setTimezone(1, "Not/AZone");
    expect(result.kind).toBe("error");
  });

  it("asks the weekend question after the first weekday window, then completes", () => {
    store.ensureUser(1, 10);
    app.setTimezone(1, "UTC");
    expect(app.setActiveWindow(1, "09:00", "18:00").kind).toBe("setup_weekend");
    // Setup already completed (auto-on) at the weekday-window step.
    expect(store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].on).toBe(true);
    expect(app.setWeekendWindow(1, "same").kind).toBe("setup_complete");
    expect(store.getUser(1)?.weekendWindowSet).toBe(true);
  });

  it("later weekday-window changes return status, not the weekend question", () => {
    store.ensureUser(1, 10);
    app.setTimezone(1, "UTC");
    app.setActiveWindow(1, "09:00", "18:00");
    app.setWeekendWindow(1, "same");
    const result = app.setActiveWindow(1, "10:00", "16:00");
    expect(result.kind).toBe("status");
  });

  it("setWeekendWindow requires setup", () => {
    store.ensureUser(1, 10);
    expect(app.setWeekendWindow(1, "same").kind).toBe("need_setup");
  });

  it("setWeekendWindowStrings rejects invalid windows", () => {
    store.ensureUser(1, 10);
    app.setTimezone(1, "UTC");
    app.setActiveWindow(1, "09:00", "18:00");
    expect(app.setWeekendWindowStrings(1, "22:00", "06:00").kind).toBe(
      "error",
    );
    // First valid answer completes the weekend step; later ones are status.
    expect(app.setWeekendWindowStrings(1, "10:00", "14:00").kind).toBe(
      "setup_complete",
    );
    expect(app.setWeekendWindowStrings(1, "11:00", "15:00").kind).toBe(
      "status",
    );
    expect(store.getUser(1)?.weekendActiveWindow).toEqual({
      startMinutes: 11 * 60,
      endMinutes: 15 * 60,
    });
  });

  it("formatStatus shows the weekend line: same as weekdays, real hours, then off", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    expect(formatStatus(store.getUser(1)!)).toMatch(
      /Weekend: same as weekdays/,
    );
    store.setWeekendWindow(1, { startMinutes: 10 * 60, endMinutes: 14 * 60 });
    expect(formatStatus(store.getUser(1)!)).toMatch(/Weekend: 10:00–14:00/);
    store.setWeekendWindow(1, "same");
    expect(formatStatus(store.getUser(1)!)).toMatch(
      /Weekend: same as weekdays/,
    );
    store.setWeekendWindow(1, { startMinutes: 0, endMinutes: 0 });
    expect(formatStatus(store.getUser(1)!)).toMatch(/Weekend: off/);
  });

  it("rejects overnight Active Window", () => {
    store.ensureUser(1, 10);
    app.setTimezone(1, "UTC");
    const result = app.setActiveWindow(1, "22:00", "06:00");
    expect(result.kind).toBe("error");
  });

  it("turns Eye Rest off and on", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    expect(app.turnOff(1, EYE_REST_ACTIVITY_ID).kind).toBe("turned_off");
    expect(store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].on).toBe(false);
    expect(app.turnOn(1, EYE_REST_ACTIVITY_ID).kind).toBe("turned_on");
    expect(store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].on).toBe(true);
  });

  it("parses activity scope keywords", () => {
    expect(parseActivityScope(undefined)).toBe("all");
    expect(parseActivityScope("eyes")).toBe(EYE_REST_ACTIVITY_ID);
    expect(parseActivityScope("eye")).toBe(EYE_REST_ACTIVITY_ID);
    expect(parseActivityScope("stretch")).toBe(STRETCH_ACTIVITY_ID);
    expect(parseActivityScope("bogus")).toBeNull();
  });

  it("turns on only the scoped Activity", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setActivityOn(1, EYE_REST_ACTIVITY_ID, false);
    store.setActivityOn(1, STRETCH_ACTIVITY_ID, false);
    expect(app.turnOn(1, STRETCH_ACTIVITY_ID).kind).toBe("turned_on");
    const user = store.getUser(1)!;
    expect(user.activities[STRETCH_ACTIVITY_ID].on).toBe(true);
    expect(user.activities[EYE_REST_ACTIVITY_ID].on).toBe(false);
  });

  it("turns off all Activities with the all scope", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    expect(app.turnOff(1, "all").kind).toBe("turned_off");
    const user = store.getUser(1)!;
    expect(user.activities[EYE_REST_ACTIVITY_ID].on).toBe(false);
    expect(user.activities[STRETCH_ACTIVITY_ID].on).toBe(false);
  });

  it("status lists every Activity label", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const result = app.status(1);
    expect(result.kind).toBe("status");
    if (result.kind === "status") {
      const text = formatStatus(result.user);
      expect(text).toMatch(/Eye Rest: (on|off) every \d+ minutes/);
      expect(text).toMatch(/Stretch Break: (on|off) every \d+ minutes/);
    }
  });

  it("wipes User on delete", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    expect(app.deleteUser(1).kind).toBe("deleted");
    expect(store.getUser(1)).toBeNull();
  });

  it("status requires setup", () => {
    store.ensureUser(1, 10);
    expect(app.status(1).kind).toBe("need_setup");
  });

  it("sets a valid Interval and reports it", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const result = app.setInterval(1, 30, EYE_REST_ACTIVITY_ID);
    expect(result.kind).toBe("interval_set");
    if (result.kind === "interval_set") {
      expect(result.user.activities[EYE_REST_ACTIVITY_ID].intervalMinutes).toBe(30);
    }
    expect(
      store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].intervalMinutes,
    ).toBe(30);
  });

  it("rejects invalid Interval values without changing the stored Interval", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    for (const bad of [0, -1, 90]) {
      const result = app.setInterval(1, bad, EYE_REST_ACTIVITY_ID);
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.message).toMatch(/10, 15, 20, 30, 45, 60/);
      }
    }
    expect(
      store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].intervalMinutes,
    ).toBe(20);
  });

  it("interval change requires setup", () => {
    store.ensureUser(1, 10);
    expect(app.setInterval(1, 30, EYE_REST_ACTIVITY_ID).kind).toBe("need_setup");
  });

  it("keeps a pending Snooze and last fire across an Interval change", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setLastFireIso(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:40:00.000Z");
    store.setSnoozeUntilIso(
      1,
      EYE_REST_ACTIVITY_ID,
      "2026-03-15T09:45:00.000Z",
    );
    expect(app.setInterval(1, 45, EYE_REST_ACTIVITY_ID).kind).toBe(
      "interval_set",
    );
    const activity = store.getUser(1)!.activities[EYE_REST_ACTIVITY_ID];
    expect(activity.intervalMinutes).toBe(45);
    expect(activity.lastFireIso).toBe("2026-03-15T09:40:00.000Z");
    expect(activity.snoozeUntilIso).toBe("2026-03-15T09:45:00.000Z");
  });

  it("records a Done action on the Reminder it answers", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setLastFireIso(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:40:00.000Z");
    store.setLatestReminderMessageId(1, EYE_REST_ACTIVITY_ID, 55);
    store.recordReminderFired(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:40:00.000Z");
    const result = app.doneReminder(1, EYE_REST_ACTIVITY_ID, 55);
    expect(result.kind).toBe("done");
    expect(
      store.listReminderEvents(1, EYE_REST_ACTIVITY_ID, "2026-01-01T00:00:00.000Z"),
    ).toEqual([{ fireIso: "2026-03-15T09:40:00.000Z", action: "done" }]);
  });

  it("records a Snoozed action on the Reminder it answers", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setLastFireIso(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:40:00.000Z");
    store.setLatestReminderMessageId(1, EYE_REST_ACTIVITY_ID, 55);
    store.recordReminderFired(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:40:00.000Z");
    const result = app.snoozeReminder(1, EYE_REST_ACTIVITY_ID, 55);
    expect(result.kind).toBe("snoozed");
    expect(
      store.listReminderEvents(1, EYE_REST_ACTIVITY_ID, "2026-01-01T00:00:00.000Z"),
    ).toEqual([{ fireIso: "2026-03-15T09:40:00.000Z", action: "snoozed" }]);
  });

  it("does not record an action when the Reminder is stale", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setLastFireIso(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:40:00.000Z");
    store.setLatestReminderMessageId(1, EYE_REST_ACTIVITY_ID, 99);
    store.recordReminderFired(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:40:00.000Z");
    expect(app.doneReminder(1, EYE_REST_ACTIVITY_ID, 55).kind).toBe("stale");
    expect(
      store.listReminderEvents(1, EYE_REST_ACTIVITY_ID, "2026-01-01T00:00:00.000Z"),
    ).toEqual([{ fireIso: "2026-03-15T09:40:00.000Z", action: null }]);
  });

  it("serves stats for a set-up User", () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.recordReminderFired(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:00:00.000Z");
    store.recordReminderAction(
      1,
      EYE_REST_ACTIVITY_ID,
      "2026-03-15T09:00:00.000Z",
      "done",
      "2026-03-15T09:01:00.000Z",
    );
    store.recordReminderFired(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:40:00.000Z");
    const result = app.stats(1);
    expect(result.kind).toBe("stats");
    if (result.kind === "stats") {
      const stats = result.statsByActivity[EYE_REST_ACTIVITY_ID];
      expect(stats.todayFires).toBe(2);
      expect(stats.todayDone).toBe(1);
      expect(stats.weekFires).toBe(2);
      expect(stats.weekSnoozed).toBe(0);
      expect(stats.streak).toBe(0);
      expect(result.statsByActivity[STRETCH_ACTIVITY_ID].weekFires).toBe(0);
    }
  });

  it("stats requires setup", () => {
    store.ensureUser(1, 10);
    expect(app.stats(1).kind).toBe("need_setup");
  });
});
