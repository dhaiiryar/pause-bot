# Pause Bot

Multi-user Telegram bot that reminds people to do healthcare activities on a schedule. Ships two Activities: **Eye Rest** (every 20 minutes by default, 20-20-20 message) and **Stretch Break** (every 60 minutes by default), each inside the user’s shared Active Window.

Domain language: [`CONTEXT.md`](./CONTEXT.md). Decisions: [`docs/adr/`](./docs/adr/).

## Features (V1)

- Public multi-user; **private chats only**
- Setup: **Timezone** (IANA, common list + Other) → **Active Window** → Activities **on**
- Two Activities, each on its own Interval grid from window start: **Eye Rest** (default 20 min) and **Stretch Break** (default 60 min)
- Per-Activity reminders, toggles, and intervals (`/on [eyes|stretch]`, `/interval [eyes|stretch] [minutes]`)
- Each Reminder offers **Done** (no schedule change) and **Snooze** (+5 min delay-only)
- `/on` `/off` (settings kept), `/delete` (wipe), `/status`, `/stats`, `/window`, `/timezone`
- Menu-first inline keyboards
- Permanent Telegram delivery failure → auto-off, keep settings
- TypeScript + long polling + SQLite

## Requirements

- Node.js 20+
- A bot token from [@BotFather](https://t.me/BotFather)

## Setup (homelab)

**AI agent E2E (clone → configure → start → smoke test):**  
[docs/AGENT_E2E_LOCAL_SETUP.md](./docs/AGENT_E2E_LOCAL_SETUP.md) — share that file with an agent.

```bash
cp .env.example .env
# edit BOT_TOKEN=  (note: the app does not auto-load .env; export vars or prefix the command)

npm install
npm test
npm run typecheck
export BOT_TOKEN=…   # required in the process environment
npm run dev
```

Production-style:

```bash
npm run build
export BOT_TOKEN=…
export DATABASE_PATH=/var/lib/pause-bot/pause-bot.sqlite
npm start
```

### systemd sketch

```ini
[Unit]
Description=Pause Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/pause-bot
Environment=BOT_TOKEN=…
Environment=DATABASE_PATH=/var/lib/pause-bot/pause-bot.sqlite
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## User commands

| Command | Meaning |
|--------|---------|
| `/start` | Setup or status |
| `/status` | Current settings |
| `/stats` | Reminder adherence stats per Activity |
| `/on [eyes\|stretch]` / `/off [eyes\|stretch]` | Activities on/off (no argument = all) |
| `/timezone [IANA]` | Set or pick timezone |
| `/window [HH:MM HH:MM]` | Set or pick Active Window |
| `/interval [eyes\|stretch] [minutes]` | Set an Activity's interval (10, 15, 20, 30, 45, 60) |
| `/delete` | Wipe all data (confirm) |

## Tests

```bash
npm test
```

Seams: Active Window validation, schedule grid, user store, delivery-failure policy, bot handlers (fake Telegram API), reminder runner.
