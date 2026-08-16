import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DateTime } from "luxon";
import { UserStore } from "../store/user-store.js";
import { createBot, registerBotCommands, BOT_COMMANDS } from "./create-bot.js";
import {
  EYE_REST_ACTIVITY_ID,
  STRETCH_ACTIVITY_ID,
} from "../domain/activities.js";
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
    expect(lastText()).toMatch(/activities are on/i);
    const user = store.getUser(1)!;
    expect(user.setupComplete).toBe(true);
    expect(user.timezone).toBe("UTC");
    expect(user.activities[EYE_REST_ACTIVITY_ID].on).toBe(true);
    expect(user.activities[STRETCH_ACTIVITY_ID].on).toBe(true);
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

  it("replies to /stats with adherence stats", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(privateUpdate("/stats"));
    expect(lastText()).toMatch(/stats/i);
    expect(lastText()).toMatch(/streak/i);
  });

  it("serves stats via the act:stats callback", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(callbackUpdate("act:stats"));
    expect(lastText()).toMatch(/stats/i);
    expect(lastText()).toMatch(/streak/i);
  });

  it("/stats before setup asks to finish setup", async () => {
    store.ensureUser(1, 10);
    const bot = botWithCapture();
    await bot.handleUpdate(privateUpdate("/stats"));
    expect(lastText()).toMatch(/setup/i);
  });

  it("/interval with no arg replies with the preset Interval keyboard", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(privateUpdate("/interval"));
    expect(lastText()).toMatch(/interval/i);
    const msg = [...sent].reverse().find((s) => s.method === "sendMessage");
    const markup = msg?.payload["reply_markup"] as {
      inline_keyboard: Array<Array<{ callback_data: string }>>;
    };
    const datas = markup.inline_keyboard.flat().map((b) => b.callback_data);
    expect(datas).toContain("ivl:eye_rest:20");
  });

  it("/interval 30 persists the Interval and confirms it", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(privateUpdate("/interval 30"));
    expect(
      store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].intervalMinutes,
    ).toBe(30);
    expect(lastText()).toMatch(/30 minutes/i);
  });

  it("rejects an off-preset /interval argument", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(privateUpdate("/interval 25"));
    expect(lastText()).toMatch(/Interval must be one of/i);
    expect(
      store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].intervalMinutes,
    ).toBe(20);
  });

  it("ivl:45 callback persists the Interval", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(callbackUpdate("ivl:eye_rest:45"));
    expect(
      store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].intervalMinutes,
    ).toBe(45);
    expect(lastText()).toMatch(/Eye Rest interval set to 45 minutes/i);
  });

  it("/interval stretch 30 sets the Stretch Break Interval", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(privateUpdate("/interval stretch 30"));
    expect(
      store.getUser(1)?.activities[STRETCH_ACTIVITY_ID].intervalMinutes,
    ).toBe(30);
    expect(
      store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].intervalMinutes,
    ).toBe(20);
    expect(lastText()).toMatch(/Stretch Break interval set to 30 minutes/i);
  });

  it("/interval stretch with no minutes offers the Stretch Break presets", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(privateUpdate("/interval stretch"));
    const msg = [...sent].reverse().find((s) => s.method === "sendMessage");
    const markup = msg?.payload["reply_markup"] as {
      inline_keyboard: Array<Array<{ callback_data: string }>>;
    };
    const datas = markup.inline_keyboard.flat().map((b) => b.callback_data);
    expect(datas).toContain("ivl:stretch_break:60");
  });

  it("rejects an unknown /interval activity keyword", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(privateUpdate("/interval bogus 30"));
    expect(lastText()).toMatch(/Unknown activity/i);
  });

  it("/off with no argument turns off every Activity", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(privateUpdate("/off"));
    const user = store.getUser(1)!;
    expect(user.activities[EYE_REST_ACTIVITY_ID].on).toBe(false);
    expect(user.activities[STRETCH_ACTIVITY_ID].on).toBe(false);
  });

  it("/off stretch turns off only Stretch Break", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(privateUpdate("/off stretch"));
    const user = store.getUser(1)!;
    expect(user.activities[STRETCH_ACTIVITY_ID].on).toBe(false);
    expect(user.activities[EYE_REST_ACTIVITY_ID].on).toBe(true);
  });

  it("act:toggle:stretch_break toggles only Stretch Break", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(callbackUpdate("act:toggle:stretch_break"));
    let user = store.getUser(1)!;
    expect(user.activities[STRETCH_ACTIVITY_ID].on).toBe(false);
    expect(user.activities[EYE_REST_ACTIVITY_ID].on).toBe(true);
    await bot.handleUpdate(callbackUpdate("act:toggle:stretch_break"));
    user = store.getUser(1)!;
    expect(user.activities[STRETCH_ACTIVITY_ID].on).toBe(true);
  });

  it("Done on latest Stretch Break Reminder strips its buttons", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    store.setLatestReminderMessageId(1, STRETCH_ACTIVITY_ID, 66);
    const bot = botWithCapture();
    await bot.handleUpdate(
      callbackUpdate("rem:done:stretch_break", 1, 10, 66),
    );
    const edit = sent.find((s) => s.method === "editMessageReplyMarkup");
    expect(edit?.payload).toMatchObject({
      chat_id: 10,
      message_id: 66,
      reply_markup: { inline_keyboard: [] },
    });
    const answered = sent.find((s) => s.method === "answerCallbackQuery");
    expect(String(answered?.payload["text"] ?? "")).toMatch(/done/i);
  });

  it("/status shows the stored Interval, not the default constant", async () => {
    store.ensureUser(1, 10);
    store.setTimezone(1, "UTC");
    store.setActiveWindow(1, { startMinutes: 9 * 60, endMinutes: 18 * 60 });
    const bot = botWithCapture();
    await bot.handleUpdate(privateUpdate("/interval 45"));
    await bot.handleUpdate(privateUpdate("/status"));
    expect(lastText()).toMatch(/every 45 minutes/i);
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
