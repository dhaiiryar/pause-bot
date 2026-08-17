import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DateTime } from "luxon";
import { Bot, GrammyError } from "grammy";
import { UserStore } from "../store/user-store.js";
import { tickReminders } from "./runner.js";
import {
  EYE_REST_ACTIVITY_ID,
  EYE_REST_MESSAGE,
  EYE_REST_MESSAGES,
  STRETCH_ACTIVITY_ID,
  STRETCH_MESSAGES,
} from "../domain/activities.js";
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
    // Setup auto-ons every Activity; Eye Rest tests want Eye Rest only.
    store.setActivityOn(1, STRETCH_ACTIVITY_ID, false);
  }

  function botThatSends(
    onSend: (chatId: number, text: string, payload: Record<string, unknown>) => void,
    options?: {
      messageId?: number;
      onEdit?: (payload: Record<string, unknown>) => void;
    },
  ): Bot {
    let nextId = options?.messageId ?? 1;
    const bot = new Bot("0000000000:TEST_TOKEN_FOR_UNIT_TESTS_ONLY", {
      botInfo: testBotInfo,
    });
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === "sendMessage") {
        const p = payload as { chat_id: number; text: string };
        const messageId = nextId++;
        onSend(p.chat_id, p.text, payload as Record<string, unknown>);
        return okResult({
          message_id: messageId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: p.chat_id, type: "private" as const, first_name: "T" },
          text: p.text,
        });
      }
      if (method === "editMessageReplyMarkup") {
        options?.onEdit?.(payload as Record<string, unknown>);
        return okResult(true);
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
    const result = await tickReminders({
      store,
      bot,
      now: () => now,
      pickCopy: (_activityId) => EYE_REST_MESSAGE,
    });
    expect(result.sent).toBe(1);
    expect(messages[0]).toEqual({ chatId: 10, text: EYE_REST_MESSAGE });
    expect(store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID].lastFireIso).toBe(
      "2026-03-15T09:00:00.000Z",
    );
    expect(
      store.listReminderEvents(
        1,
        EYE_REST_ACTIVITY_ID,
        "2026-01-01T00:00:00.000Z",
      ),
    ).toEqual([{ fireIso: "2026-03-15T09:00:00.000Z", action: null }]);
  });

  it("sends one Reminder per due Activity when both are on", async () => {
    setupUser();
    store.setActivityOn(1, STRETCH_ACTIVITY_ID, true);
    const messages: string[] = [];
    const bot = botThatSends((_c, text) => messages.push(text));
    const now = DateTime.fromISO("2026-03-15T10:00:00", { zone: "UTC" });
    const result = await tickReminders({ store, bot, now: () => now });
    expect(result.sent).toBe(2);
    expect(
      messages.filter((m) => (EYE_REST_MESSAGES as readonly string[]).includes(m)),
    ).toHaveLength(1);
    expect(
      messages.filter((m) => (STRETCH_MESSAGES as readonly string[]).includes(m)),
    ).toHaveLength(1);
    expect(
      store.getUser(1)?.activities[STRETCH_ACTIVITY_ID]
        .latestReminderMessageId,
    ).toBe(2);
  });

  it("uses the injected copy picker for the Reminder text", async () => {
    setupUser();
    const messages: string[] = [];
    const bot = botThatSends((_c, text) => messages.push(text));
    const now = DateTime.fromISO("2026-03-15T09:00:00", { zone: "UTC" });
    await tickReminders({
      store,
      bot,
      now: () => now,
      pickCopy: (_activityId) => EYE_REST_MESSAGES[3]!,
    });
    expect(messages[0]).toBe(EYE_REST_MESSAGES[3]);
  });

  it("attaches Done and Snooze and records latest Reminder message id", async () => {
    setupUser();
    let payload: Record<string, unknown> | undefined;
    const bot = botThatSends((_c, _t, p) => {
      payload = p;
    }, { messageId: 77 });
    const now = DateTime.fromISO("2026-03-15T09:00:00", { zone: "UTC" });
    await tickReminders({ store, bot, now: () => now });
    const markup = payload?.["reply_markup"] as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    const buttons = markup.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(["Done", "Snooze 5 min"]);
    expect(buttons.map((b) => b.callback_data)).toEqual([
      "rem:done:eye_rest",
      "rem:snooze:eye_rest",
    ]);
    expect(
      store.getUser(1)?.activities[EYE_REST_ACTIVITY_ID]
        .latestReminderMessageId,
    ).toBe(77);
  });

  it("fires at pending Snooze time and clears Snooze", async () => {
    setupUser();
    store.setSnoozeUntilIso(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:25:00.000Z");
    store.setLastFireIso(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:00:00.000Z");
    let count = 0;
    const bot = botThatSends(() => {
      count += 1;
    });
    const now = DateTime.fromISO("2026-03-15T09:25:00", { zone: "UTC" });
    const result = await tickReminders({ store, bot, now: () => now });
    expect(result.sent).toBe(1);
    expect(count).toBe(1);
    const activity = store.getUser(1)!.activities[EYE_REST_ACTIVITY_ID];
    expect(activity.snoozeUntilIso).toBeNull();
    expect(activity.lastFireIso).toBe("2026-03-15T09:25:00.000Z");
  });

  it("suppresses grid while Snooze is pending", async () => {
    setupUser();
    store.setSnoozeUntilIso(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:25:00.000Z");
    store.setLastFireIso(1, EYE_REST_ACTIVITY_ID, "2026-03-15T09:00:00.000Z");
    let count = 0;
    const bot = botThatSends(() => {
      count += 1;
    });
    const now = DateTime.fromISO("2026-03-15T09:20:00", { zone: "UTC" });
    const result = await tickReminders({ store, bot, now: () => now });
    expect(result.sent).toBe(0);
    expect(count).toBe(0);
  });

  it("strips buttons from prior Reminder before sending a new one", async () => {
    setupUser();
    store.setLatestReminderMessageId(1, EYE_REST_ACTIVITY_ID, 50);
    const edits: Array<Record<string, unknown>> = [];
    const bot = botThatSends(
      () => {},
      {
        messageId: 51,
        onEdit: (p) => edits.push(p),
      },
    );
    const now = DateTime.fromISO("2026-03-15T09:00:00", { zone: "UTC" });
    await tickReminders({ store, bot, now: () => now });
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      chat_id: 10,
      message_id: 50,
    });
    expect(edits[0]?.["reply_markup"]).toEqual({ inline_keyboard: [] });
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

  it("applies the weekend window on a Saturday", async () => {
    setupUser();
    store.setWeekendWindow(1, { startMinutes: 10 * 60, endMinutes: 14 * 60 });
    let count = 0;
    const bot = botThatSends(() => {
      count += 1;
    });

    // 2026-03-14 is a Saturday (luxon weekday 6): 09:00 is inside the
    // weekday window but not the weekend one.
    const satNine = DateTime.fromISO("2026-03-14T09:00:00", { zone: "UTC" });
    expect(satNine.weekday).toBe(6);
    expect((await tickReminders({ store, bot, now: () => satNine })).sent).toBe(0);

    const satTen = DateTime.fromISO("2026-03-14T10:00:00", { zone: "UTC" });
    expect((await tickReminders({ store, bot, now: () => satTen })).sent).toBe(1);
    expect(count).toBe(1);
  });

  it("applies the weekday window on a Monday", async () => {
    setupUser();
    store.setWeekendWindow(1, { startMinutes: 10 * 60, endMinutes: 14 * 60 });
    let count = 0;
    const bot = botThatSends(() => {
      count += 1;
    });
    // 2026-03-16 is a Monday: the weekday window 09:00–18:00 applies again.
    const monNine = DateTime.fromISO("2026-03-16T09:00:00", { zone: "UTC" });
    expect(monNine.weekday).toBe(1);
    expect((await tickReminders({ store, bot, now: () => monNine })).sent).toBe(1);
    expect(count).toBe(1);
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
    expect(
      store.listReminderEvents(
        1,
        EYE_REST_ACTIVITY_ID,
        "2026-01-01T00:00:00.000Z",
      ),
    ).toEqual([]);
  });
});
