import { Bot, type Context, type BotConfig } from "grammy";
import {
  BotApp,
  formatSetupComplete,
  formatStatus,
  type AppResult,
} from "./app.js";
import {
  deleteConfirmKeyboard,
  mainMenuKeyboard,
  timezoneKeyboard,
  windowPresetsKeyboard,
} from "./keyboards.js";
import type { UserStore } from "../store/user-store.js";
import { EYE_REST_ACTIVITY_ID } from "../domain/activities.js";

export function createBot(
  token: string,
  store: UserStore,
  config?: BotConfig<Context>,
): Bot {
  const app = new BotApp(store);
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

  bot.on("callback_query:data", async (ctx) => {
    if (!ctx.chat || ctx.chat.type !== "private" || !ctx.from) {
      await ctx.answerCallbackQuery({ text: PRIVATE_ONLY_TEXT });
      return;
    }
    store.ensureUser(ctx.from.id, ctx.chat.id);
    await ctx.answerCallbackQuery();
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;

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
      case "act:window":
        await ctx.reply("Choose Active Window:", {
          reply_markup: windowPresetsKeyboard(),
        });
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

const PRIVATE_ONLY_TEXT = "Please message me in a private chat.";
const DELETE_CONFIRM_TEXT =
  "This permanently wipes your settings and stops reminders.";

async function ensurePrivate(ctx: Context): Promise<boolean> {
  if (ctx.chat?.type === "private" && ctx.from) return true;
  await ctx.reply(PRIVATE_ONLY_TEXT);
  return false;
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
