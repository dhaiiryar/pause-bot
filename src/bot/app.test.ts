import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UserStore } from "../store/user-store.js";
import { BotApp } from "./app.js";
import { EYE_REST_ACTIVITY_ID } from "../domain/activities.js";

describe("Bot app intents", () => {
  let dir: string;
  let store: UserStore;
  let app: BotApp;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pause-bot-app-"));
    store = UserStore.open(join(dir, "test.db"));
    app = new BotApp(store);
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

  it("completes setup with valid Active Window", () => {
    store.ensureUser(1, 10);
    app.setTimezone(1, "UTC");
    const result = app.setActiveWindow(1, "09:00", "18:00");
    expect(result.kind).toBe("setup_complete");
    expect(store.getUser(1)?.setupComplete).toBe(true);
    expect(store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].on).toBe(true);
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
    expect(app.turnOff(1).kind).toBe("turned_off");
    expect(store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].on).toBe(false);
    expect(app.turnOn(1).kind).toBe("turned_on");
    expect(store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].on).toBe(true);
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
});
