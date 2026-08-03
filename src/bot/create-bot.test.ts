import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DateTime } from "luxon";
import { UserStore } from "../store/user-store.js";
import { createBot, registerBotCommands, BOT_COMMANDS } from "./create-bot.js";
import { EYE_REST_ACTIVITY_ID } from "../domain/activities.js";
import { okResult, testBotInfo } from "../test/fake-telegram.js";

type SentMessage = {
  method: string;
  payload: Record<string, unknown>;
};

function privateUpdate(text: string, userId = 1, chatId = 10) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "private" as const, first_name: "T" },
      from: { id: userId, is_bot: false, first_name: "T" },
      text,
      entities: text.startsWith("/")
        ? [{ offset: 0, length: text.split(/\s/)[0]!.length, type: "bot_command" as const }]
        : undefined,
    },
  };
}

function groupUpdate(text: string) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: -1001, type: "group" as const, title: "G" },
      from: { id: 1, is_bot: false, first_name: "T" },
      text,
      entities: text.startsWith("/")
        ? [{ offset: 0, length: text.split(/\s/)[0]!.length, type: "bot_command" as const }]
        : undefined,
    },
  };
}

function callbackUpdate(
  data: string,
  userId = 1,
  chatId = 10,
  messageId = 2,
) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    callback_query: {
      id: "cb1",
      from: { id: userId, is_bot: false, first_name: "T" },
      chat_instance: "x",
      data,
      message: {
        message_id: messageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: "private" as const, first_name: "T" },
        text: "👁 Eye rest",
      },
    },
  };
}

describe("Bot handlers (fake Telegram API)", () => {
  let dir: string;
  let store: UserStore;
  let sent: SentMessage[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pause-bot-handlers-"));
    store = UserStore.open(join(dir, "test.db"));
    sent = [];
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function botWithCapture() {
    const bot = createBot("0000000000:TEST_TOKEN_FOR_UNIT_TESTS_ONLY", store, {
      botInfo: testBotInfo,
    });
    bot.api.config.use(async (_prev, method, payload) => {
      sent.push({ method, payload: payload as Record<string, unknown> });
      if (method === "sendMessage") {
        const p = payload as { chat_id: number; text: string };
        return okResult({
          message_id: sent.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: p.chat_id, type: "private" as const, first_name: "T" },
          text: p.text,
        });
      }
      return okResult(true);
    });
    return bot;
  }

  function lastText(): string {
    const msg = [...sent].reverse().find((s) => s.method === "sendMessage");
    return String(msg?.payload["text"] ?? "");
  }

  it("registers slash commands via setMyCommands for the Telegram / menu", async () => {
    // Telegram clients populate the `/` menu from setMyCommands, not from
    // bot.command() handlers. Without this call the menu stays empty.
    const bot = botWithCapture();
    await registerBotCommands(bot);
    const call = sent.find((s) => s.method === "setMyCommands");
    expect(call).toBeDefined();
    const commands = call!.payload["commands"] as Array<{
      command: string;
      description: string;
    }>;
    expect(commands.map((c) => c.command).sort()).toEqual(
      [...BOT_COMMANDS].map((c) => c.command).sort(),
    );
    expect(commands.every((c) => c.description.length >= 3)).toBe(true);
  });

  it("tells group chats to use private", async () => {
    const bot = botWithCapture();
    await bot.handleUpdate(groupUpdate("/start"));
    expect(lastText().toLowerCase()).toMatch(/private/);
  });

  it("starts timezone setup on /start", async () => {
    const bot = botWithCapture();
    await bot.handleUpdate(privateUpdate("/start"));
    expect(lastText()).toMatch(/timezone/i);
    expect(store.getUser(1)).not.toBeNull();
  });

  it("completes setup via timezone callback and window preset", async () => {
    const bot = botWithCapture();
    await bot.handleUpdate(privateUpdate("/start"));
    await bot.handleUpdate(callbackUpdate("tz:UTC"));
    expect(lastText()).toMatch(/Active Window/i);
    await bot.handleUpdate(callbackUpdate("win:09:00-18:00"));
    expect(lastText()).toMatch(/Eye Rest is on/i);
    const user = store.getUser(1)!;
    expect(user.setupComplete).toBe(true);
    expect(user.timezone).toBe("UTC");
    expect(user.activities[EYE_REST_ACTIVITY_ID].on).toBe(true);
  });

  it("turns off via /off", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(privateUpdate("/off"));
    expect(store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].on).toBe(false);
    expect(lastText()).toMatch(/off/i);
  });

  it("wipes data via delete callback", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(callbackUpdate("act:delete"));
    expect(store.getUser(1)).toBeNull();
    expect(lastText()).toMatch(/deleted/i);
  });

  it("Done on latest Reminder strips buttons and does not set Snooze", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setLatestReminderMessageId(1, EYE_REST_ACTIVITY_ID, 55);
    const bot = botWithCapture();
    await bot.handleUpdate(callbackUpdate("rem:done:eye_rest", 1, 10, 55));
    expect(
      store.getUser(1)!.activities[EYE_REST_ACTIVITY_ID].snoozeUntilIso,
    ).toBeNull();
    const edit = sent.find((s) => s.method === "editMessageReplyMarkup");
    expect(edit?.payload).toMatchObject({
      chat_id: 10,
      message_id: 55,
      reply_markup: { inline_keyboard: [] },
    });
    const answered = sent.find((s) => s.method === "answerCallbackQuery");
    expect(String(answered?.payload["text"] ?? "")).toMatch(/done/i);
  });

  it("Snooze on latest Reminder sets +5 min delay", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setLatestReminderMessageId(1, EYE_REST_ACTIVITY_ID, 55);
    const now = DateTime.fromISO("2026-03-15T10:00:00", { zone: "UTC" });
    const bot = createBot("0000000000:TEST_TOKEN_FOR_UNIT_TESTS_ONLY", store, {
      botInfo: testBotInfo,
      now: () => now,
    });
    bot.api.config.use(async (_prev, method, payload) => {
      sent.push({ method, payload: payload as Record<string, unknown> });
      return okResult(true);
    });
    await bot.handleUpdate(callbackUpdate("rem:snooze:eye_rest", 1, 10, 55));
    expect(
      store.getUser(1)!.activities[EYE_REST_ACTIVITY_ID].snoozeUntilIso,
    ).toBe("2026-03-15T10:05:00.000Z");
    const answered = sent.find((s) => s.method === "answerCallbackQuery");
    expect(String(answered?.payload["text"] ?? "")).toMatch(/snooze/i);
  });

  it("stale Done/Snooze on superseded Reminder is rejected", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setLatestReminderMessageId(1, EYE_REST_ACTIVITY_ID, 99);
    const bot = botWithCapture();
    await bot.handleUpdate(callbackUpdate("rem:done:eye_rest", 1, 10, 55));
    expect(
      store.getUser(1)!.activities[EYE_REST_ACTIVITY_ID].snoozeUntilIso,
    ).toBeNull();
    const answered = sent.find((s) => s.method === "answerCallbackQuery");
    expect(String(answered?.payload["text"] ?? "").toLowerCase()).toMatch(
      /out of date|superseded|old/,
    );
  });

  it("rejects Snooze when Eye Rest is off", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setLatestReminderMessageId(1, EYE_REST_ACTIVITY_ID, 55);
    store.setActivityOn(1, EYE_REST_ACTIVITY_ID, false);
    const now = DateTime.fromISO("2026-03-15T10:00:00", { zone: "UTC" });
    const bot = createBot("0000000000:TEST_TOKEN_FOR_UNIT_TESTS_ONLY", store, {
      botInfo: testBotInfo,
      now: () => now,
    });
    bot.api.config.use(async (_prev, method, payload) => {
      sent.push({ method, payload: payload as Record<string, unknown> });
      return okResult(true);
    });
    await bot.handleUpdate(callbackUpdate("rem:snooze:eye_rest", 1, 10, 55));
    expect(
      store.getUser(1)!.activities[EYE_REST_ACTIVITY_ID].snoozeUntilIso,
    ).toBeNull();
    const answered = sent.find((s) => s.method === "answerCallbackQuery");
    expect(String(answered?.payload["text"] ?? "").toLowerCase()).toMatch(
      /off/,
    );
  });
});
