import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createBot } from "./bot/create-bot.js";
import { UserStore } from "./store/user-store.js";
import { tickReminders } from "./scheduler/runner.js";

const token = process.env["BOT_TOKEN"];
if (!token) {
  console.error("Set BOT_TOKEN to your Telegram bot token.");
  process.exit(1);
}

const dbPath = resolve(process.env["DATABASE_PATH"] ?? "./data/pause-bot.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

const store = UserStore.open(dbPath);
const bot = createBot(token, store);

const tickMs = Number(process.env["SCHEDULER_INTERVAL_MS"] ?? "15000");

const timer = setInterval(() => {
  void tickReminders({ store, bot }).catch((err) => {
    console.error("scheduler tick failed", err);
  });
}, Number.isFinite(tickMs) && tickMs > 0 ? tickMs : 15_000);

timer.unref?.();

async function shutdown(signal: string) {
  console.log(`Shutting down (${signal})…`);
  clearInterval(timer);
  bot.stop();
  store.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

console.log(`Pause Bot starting (long polling). DB: ${dbPath}`);
await bot.start({
  onStart: (info) => {
    console.log(`Logged in as @${info.username}`);
  },
});
