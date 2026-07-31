# Pause Bot

Multi-user Telegram bot that reminds people to do healthcare activities on a schedule. **V1** ships **Eye Rest** only: every 20 minutes inside each user’s Active Window, with a 20-20-20 message.

Domain language: [`CONTEXT.md`](./CONTEXT.md). Decisions: [`docs/adr/`](./docs/adr/).

## Features (V1)

- Public multi-user; **private chats only**
- Setup: **Timezone** (IANA, common list + Other) → **Active Window** → Eye Rest **on**
- Fire-and-forget reminders; grid from window start, every 20 minutes
- `/on` `/off` (settings kept), `/delete` (wipe), `/status`, `/window`, `/timezone`
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
| `/on` / `/off` | Eye Rest on/off |
| `/timezone [IANA]` | Set or pick timezone |
| `/window [HH:MM HH:MM]` | Set or pick Active Window |
| `/delete` | Wipe all data (confirm) |

## Tests

```bash
npm test
```

Seams: Active Window validation, schedule grid, user store, delivery-failure policy, bot handlers (fake Telegram API), reminder runner.
