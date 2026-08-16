import { Bot, type Context, type BotConfig } from "grammy";
import type { BotCommand } from "grammy/types";
import {
  BotApp,
  formatAdherence,
  formatSetupComplete,
  formatStatus,
  type AppResult,
  type Clock,
  type ReminderActionResult,
} from "./app.js";
import {
  deleteConfirmKeyboard,
  emptyReplyMarkup,
  intervalPresetsKeyboard,
  mainMenuKeyboard,
  timezoneKeyboard,
  windowPresetsKeyboard,
} from "./keyboards.js";
import type { UserStore } from "../store/user-store.js";
import {
  EYE_REST_ACTIVITY_ID,
  type ActivityId,
} from "../domain/activities.js";

export type CreateBotOptions = BotConfig<Context> & {
  now?: Clock;
};

/**
 * Commands published via setMyCommands so Telegram clients show them when the
 * user types `/`. bot.command() only registers in-process handlers — it does
 * not populate the client menu.
 */
export const BOT_COMMANDS: readonly BotCommand[] = [
  { command: "start", description: "Setup or show status" },
  { command: "status", description: "Current settings" },
  { command: "stats", description: "Your Eye Rest stats" },
  { command: "on", description: "Turn Eye Rest on" },
  { command: "off", description: "Turn Eye Rest off" },
  { command: "timezone", description: "Set or pick timezone" },
  { command: "window", description: "Set or pick Active Window" },
  { command: "interval", description: "Set Eye Rest interval" },
  { command: "delete", description: "Wipe all your data" },
];

/** Publish BOT_COMMANDS to Telegram (powers the `/` slash menu). */
export async function registerBotCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands(BOT_COMMANDS);
}

export function createBot(
  token: string,
  store: UserStore,
  options?: CreateBotOptions,
): Bot {
  const { now, ...config } = options ?? {};
  const app = now ? new BotApp(store, now) : new BotApp(store);
  const bot = new Bot(token, config);

  bot.command("start", async (ctx) => {
    if (!(await ensurePrivate(ctx))) return;
    const result = app.onStart({
      telegramUserId: ctx.from!.id,
      chatId: ctx.chat!.id,
      chatType: ctx.chat!.type as "private",
    });
    await replyResult(ctx, result);
  });

  bot.command("status", async (ctx) => {
    if (!(await ensurePrivate(ctx))) return;
    store.ensureUser(ctx.from!.id, ctx.chat!.id);
    await replyResult(ctx, app.status(ctx.from!.id));
  });

  bot.command("on", async (ctx) => {
    if (!(await ensurePrivate(ctx))) return;
    store.ensureUser(ctx.from!.id, ctx.chat!.id);
    await replyResult(ctx, app.turnOn(ctx.from!.id));
  });

  bot.command("off", async (ctx) => {
    if (!(await ensurePrivate(ctx))) return;
    store.ensureUser(ctx.from!.id, ctx.chat!.id);
    await replyResult(ctx, app.turnOff(ctx.from!.id));
  });

  bot.command("stats", async (ctx) => {
    if (!(await ensurePrivate(ctx))) return;
    store.ensureUser(ctx.from!.id, ctx.chat!.id);
    await replyResult(ctx, app.stats(ctx.from!.id));
  });

  bot.command("delete", async (ctx) => {
    if (!(await ensurePrivate(ctx))) return;
    await ctx.reply(DELETE_CONFIRM_TEXT, {
      reply_markup: deleteConfirmKeyboard(),
    });
  });

  bot.command("timezone", async (ctx) => {
    if (!(await ensurePrivate(ctx))) return;
    store.ensureUser(ctx.from!.id, ctx.chat!.id);
    const arg = ctx.match?.toString().trim();
    if (!arg) {
      await ctx.reply("Pick your timezone:", {
        reply_markup: timezoneKeyboard(),
      });
      return;
    }
    await replyResult(ctx, app.setTimezone(ctx.from!.id, arg));
  });

  bot.command("window", async (ctx) => {
    if (!(await ensurePrivate(ctx))) return;
    store.ensureUser(ctx.from!.id, ctx.chat!.id);
    const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
    if (parts.length !== 2) {
      await ctx.reply(
        "Set your Active Window (same day, end after start):",
        { reply_markup: windowPresetsKeyboard() },
      );
      return;
    }
    await replyResult(
      ctx,
      app.setActiveWindow(ctx.from!.id, parts[0]!, parts[1]!),
    );
  });

  bot.command("interval", async (ctx) => {
    if (!(await ensurePrivate(ctx))) return;
    store.ensureUser(ctx.from!.id, ctx.chat!.id);
    const arg = ctx.match?.toString().trim();
    if (!arg) {
      await replyIntervalPresets(ctx);
      return;
    }
    const minutes = Number(arg);
    await replyResult(ctx, app.setInterval(ctx.from!.id, minutes));
  });

  bot.on("callback_query:data", async (ctx) => {
    if (!ctx.chat || ctx.chat.type !== "private" || !ctx.from) {
      await ctx.answerCallbackQuery({ text: PRIVATE_ONLY_TEXT });
      return;
    }
    store.ensureUser(ctx.from.id, ctx.chat.id);
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const messageId = ctx.callbackQuery.message?.message_id;

    if (data.startsWith("rem:")) {
      await handleReminderCallback(ctx, app, data, userId, messageId);
      return;
    }

    await ctx.answerCallbackQuery();

    if (data.startsWith("tz:")) {
      const zone = data.slice(3);
      if (zone === "other") {
        await ctx.reply("Send /timezone Asia/Jakarta (any IANA zone).");
        return;
      }
      await replyResult(ctx, app.setTimezone(userId, zone));
      return;
    }

    if (data.startsWith("win:")) {
      const rest = data.slice(4);
      if (rest === "custom") {
        await ctx.reply("Send /window 09:00 18:00");
        return;
      }
      const [start, end] = rest.split("-");
      await replyResult(ctx, app.setActiveWindow(userId, start!, end!));
      return;
    }

    if (data.startsWith("ivl:")) {
      const minutes = Number(data.slice(4));
      await replyResult(ctx, app.setInterval(userId, minutes));
      return;
    }

    switch (data) {
      case "act:on":
        await replyResult(ctx, app.turnOn(userId));
        return;
      case "act:off":
        await replyResult(ctx, app.turnOff(userId));
        return;
      case "act:status":
        await replyResult(ctx, app.status(userId));
        return;
      case "act:stats":
        await replyResult(ctx, app.stats(userId));
        return;
      case "act:window":
        await ctx.reply("Choose Active Window:", {
          reply_markup: windowPresetsKeyboard(),
        });
        return;
      case "act:interval":
        await replyIntervalPresets(ctx);
        return;
      case "act:timezone":
        await ctx.reply("Pick your timezone:", {
          reply_markup: timezoneKeyboard(),
        });
        return;
      case "act:delete_confirm":
        await ctx.reply(DELETE_CONFIRM_TEXT, {
          reply_markup: deleteConfirmKeyboard(),
        });
        return;
      case "act:delete":
        await replyResult(ctx, app.deleteUser(userId));
        return;
      default:
        await ctx.reply("Unknown action. Try /status.");
    }
  });

  return bot;
}

async function handleReminderCallback(
  ctx: Context,
  app: BotApp,
  data: string,
  userId: number,
  messageId: number | undefined,
): Promise<void> {
  if (messageId == null) {
    await ctx.answerCallbackQuery({ text: "That Reminder is out of date." });
    return;
  }
  const parts = data.split(":");
  const action = parts[1];
  const activityId = parts[2] as ActivityId | undefined;
  if (activityId !== EYE_REST_ACTIVITY_ID) {
    await ctx.answerCallbackQuery({ text: "Unknown activity." });
    return;
  }

  let result: ReminderActionResult;
  if (action === "done") {
    result = app.doneReminder(userId, activityId, messageId);
  } else if (action === "snooze") {
    result = app.snoozeReminder(userId, activityId, messageId);
  } else {
    await ctx.answerCallbackQuery({ text: "Unknown action." });
    return;
  }

  await applyReminderAction(ctx, result);
}

async function applyReminderAction(
  ctx: Context,
  result: ReminderActionResult,
): Promise<void> {
  switch (result.kind) {
    case "stale":
      await ctx.answerCallbackQuery({
        text: "That Reminder is out of date.",
      });
      return;
    case "need_setup":
      await ctx.answerCallbackQuery({ text: "Finish setup first (/start)." });
      return;
    case "error":
      await ctx.answerCallbackQuery({ text: result.message });
      return;
    case "done":
      await ctx.answerCallbackQuery({ text: "Done." });
      await stripReminderButtons(ctx, result.stripMessageId);
      return;
    case "snoozed":
      await ctx.answerCallbackQuery({
        text: `Snoozed ${result.minutes} min.`,
      });
      await stripReminderButtons(ctx, result.stripMessageId);
      return;
    case "snooze_outside_window":
      await ctx.answerCallbackQuery({
        text: "Snooze would be outside your Active Window.",
      });
      await stripReminderButtons(ctx, result.stripMessageId);
      return;
  }
}

async function stripReminderButtons(
  ctx: Context,
  messageId: number,
): Promise<void> {
  if (!ctx.chat) return;
  try {
    await ctx.api.editMessageReplyMarkup(ctx.chat.id, messageId, {
      reply_markup: emptyReplyMarkup(),
    });
  } catch {
    // best-effort
  }
}

const PRIVATE_ONLY_TEXT = "Please message me in a private chat.";
const DELETE_CONFIRM_TEXT =
  "This permanently wipes your settings and stops reminders.";

async function ensurePrivate(ctx: Context): Promise<boolean> {
  if (ctx.chat?.type === "private" && ctx.from) return true;
  await ctx.reply(PRIVATE_ONLY_TEXT);
  return false;
}

async function replyIntervalPresets(ctx: Context): Promise<void> {
  await ctx.reply("Pick your Eye Rest interval:", {
    reply_markup: intervalPresetsKeyboard(),
  });
}

async function replyResult(ctx: Context, result: AppResult): Promise<void> {
  switch (result.kind) {
    case "private_only":
      await ctx.reply(PRIVATE_ONLY_TEXT);
      return;
    case "setup_timezone":
      await ctx.reply(
        "Welcome to Pause Bot. Eye Rest reminders every 20 minutes inside your Active Window.\n\nFirst, pick your timezone:",
        { reply_markup: timezoneKeyboard() },
      );
      return;
    case "setup_window":
      await ctx.reply(
        "Timezone saved. Now set your Active Window (same times every day; no overnight ranges):",
        { reply_markup: windowPresetsKeyboard() },
      );
      return;
    case "setup_complete":
      await ctx.reply(formatSetupComplete(result.user), {
        reply_markup: mainMenuKeyboard(
          result.user.activities[EYE_REST_ACTIVITY_ID].on,
        ),
      });
      return;
    case "status":
      await ctx.reply(formatStatus(result.user), {
        reply_markup: mainMenuKeyboard(
          result.user.activities[EYE_REST_ACTIVITY_ID].on,
        ),
      });
      return;
    case "stats":
      await ctx.reply(formatAdherence("Eye Rest", result.stats), {
        reply_markup: mainMenuKeyboard(
          result.user.activities[EYE_REST_ACTIVITY_ID].on,
        ),
      });
      return;
    case "interval_set":
      await ctx.reply(
        `Interval set to ${result.user.activities[EYE_REST_ACTIVITY_ID].intervalMinutes} minutes.\n` +
          formatStatus(result.user),
        {
          reply_markup: mainMenuKeyboard(
            result.user.activities[EYE_REST_ACTIVITY_ID].on,
          ),
        },
      );
      return;
    case "turned_on":
      await ctx.reply("Eye Rest is on.\n" + formatStatus(result.user), {
        reply_markup: mainMenuKeyboard(true),
      });
      return;
    case "turned_off":
      await ctx.reply("Eye Rest is off. Settings kept.\n" + formatStatus(result.user), {
        reply_markup: mainMenuKeyboard(false),
      });
      return;
    case "deleted":
      await ctx.reply(
        "All your data was deleted. Send /start anytime to set up again.",
      );
      return;
    case "need_setup":
      await ctx.reply("You need to finish setup first. Send /start.");
      return;
    case "error":
      await ctx.reply(result.message);
      return;
  }
}
