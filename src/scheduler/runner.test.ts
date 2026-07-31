import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DateTime } from "luxon";
import { Bot, GrammyError } from "grammy";
import { UserStore } from "../store/user-store.js";
import { tickReminders } from "./runner.js";
import { EYE_REST_ACTIVITY_ID, EYE_REST_MESSAGE } from "../domain/activities.js";
import { okResult, testBotInfo } from "../test/fake-telegram.js";

describe("Reminder runner", () => {
  let dir: string;
  let store: UserStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pause-bot-sched-"));
    store = UserStore.open(join(dir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function setupUser() {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
  }

  function botThatSends(onSend: (chatId: number, text: string) => void): Bot {
    const bot = new Bot("0000000000:TEST_TOKEN_FOR_UNIT_TESTS_ONLY", {
      botInfo: testBotInfo,
    });
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === "sendMessage") {
        const p = payload as { chat_id: number; text: string };
        onSend(p.chat_id, p.text);
        return okResult({
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: p.chat_id, type: "private" as const, first_name: "T" },
          text: p.text,
        });
      }
      return okResult(true);
    });
    return bot;
  }

  function botThatFails(error: Error): Bot {
    const bot = new Bot("0000000000:TEST_TOKEN_FOR_UNIT_TESTS_ONLY", {
      botInfo: testBotInfo,
    });
    bot.api.config.use(async () => {
      throw error;
    });
    return bot;
  }

  it("sends Eye Rest Reminder on grid instant inside Active Window", async () => {
    setupUser();
    const messages: Array<{ chatId: number; text: string }> = [];
    const bot = botThatSends((chatId, text) => messages.push({ chatId, text }));
    const now = DateTime.fromISO("2026-03-15T09:00:00", { zone: "UTC" });
    const result = await tickReminders({ store, bot, now: () => now });
    expect(result.sent).toBe(1);
    expect(messages[0]).toEqual({ chatId: 10, text: EYE_REST_MESSAGE });
    expect(store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].lastFireIso).toBe(
      "2026-03-15T09:00:00.000Z",
    );
  });

  it("does not double-send in the same minute", async () => {
    setupUser();
    let count = 0;
    const bot = botThatSends(() => {
      count += 1;
    });
    const now = DateTime.fromISO("2026-03-15T09:20:00", { zone: "UTC" });
    await tickReminders({ store, bot, now: () => now });
    await tickReminders({ store, bot, now: () => now });
    expect(count).toBe(1);
  });

  it("does not send outside Active Window", async () => {
    setupUser();
    let count = 0;
    const bot = botThatSends(() => {
      count += 1;
    });
    const now = DateTime.fromISO("2026-03-15T08:00:00", { zone: "UTC" });
    const result = await tickReminders({ store, bot, now: () => now });
    expect(result.sent).toBe(0);
    expect(count).toBe(0);
  });

  it("auto-offs on permanent delivery failure and keeps settings", async () => {
    setupUser();
    const err = new GrammyError(
      "Forbidden: bot was blocked by the user",
      {
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was blocked by the user",
      },
      "sendMessage",
      {},
    );
    const bot = botThatFails(err);
    const now = DateTime.fromISO("2026-03-15T09:00:00", { zone: "UTC" });
    const result = await tickReminders({ store, bot, now: () => now });
    expect(result.autoOff).toBe(1);
    const user = store.getUser(1)!;
    expect(user.activities[EYE_REST_ACTIVITY_ID].on).toBe(false);
    expect(user.timezone).toBe("UTC");
    expect(user.activeWindow).not.toBeNull();
  });
});
