# Agent E2E: Set up, configure, and run Pause Bot locally

**Audience:** AI coding agents (and humans following the same steps).  
**Goal:** From a clean machine, clone this project, configure secrets, verify, start the bot, and confirm it answers on Telegram.  
**Scope:** Local / homelab long-polling only. Do **not** deploy to a VPS, open webhooks, or change product behavior unless the user asks.

Share **this file alone** with an agent, or open it inside a checkout of the repo.

---

## 0. Read this first (agent rules)

1. **Do not invent a bot token.** The user must supply `BOT_TOKEN` from Telegram [@BotFather](https://t.me/BotFather). If missing, stop and ask.
2. **Never commit** `.env`, tokens, or `data/*.sqlite` to git.
3. **Do not** force-push, rewrite history, or change the default remote unless asked.
4. Prefer **read-only checks** first (`node -v`, `npm test`) before long-running processes.
5. The process must stay **running** for reminders to fire (long polling + in-process scheduler).
6. This app does **not** auto-load `.env` files. Variables must be in the **process environment** when starting (export, shell prefix, or systemd `Environment=`).
7. Use domain language from the project when talking to the user: **User**, **Activity**, **Eye Rest**, **Active Window**, **Interval**, **Reminder**, **Timezone** (see `CONTEXT.md` if present).

---

## 1. Success criteria

You are done when **all** of the following are true:

| # | Check |
|---|--------|
| 1 | Repo is available locally with dependencies installed |
| 2 | `npm test` exits 0 |
| 3 | `npm run typecheck` exits 0 |
| 4 | Bot process is running with a real `BOT_TOKEN` |
| 5 | Logs show something like `Logged in as @<bot_username>` |
| 6 | User can open a **private** chat with the bot, send `/start`, and get a timezone setup (or status if already configured) |

Optional (if the user wants a full product smoke test):

| # | Check |
|---|--------|
| 7 | User completes Timezone + Active Window setup |
| 8 | `/status` shows Eye Rest **on**, correct window and timezone |
| 9 | Within an Active Window grid minute (e.g. window start), an Eye Rest Reminder arrives within ~one scheduler tick (default 15s) |

---

## 2. Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js 20+** | `node -v` |
| **npm** | Ships with Node |
| **Git** | To clone |
| **Network** | Outbound HTTPS to `api.telegram.org` (long polling) |
| **Build tools for native modules** | `better-sqlite3` compiles on install. On Debian/Ubuntu: `build-essential` + Python 3. On macOS: Xcode CLT. |
| **Telegram account** | To create the bot and message it |
| **`BOT_TOKEN`** | From BotFather (format like `123456789:AA...`) |

### 2.1 Obtain `BOT_TOKEN` (human + Telegram)

The agent cannot operate BotFather for the user. Instruct the user:

1. Open Telegram → search **@BotFather** → `/start`.
2. Send `/newbot` (or `/token` / `/mybots` if a bot already exists).
3. Follow prompts; copy the **HTTP API token**.
4. Paste the token to the agent **out of band** (chat/secret), or set it themselves in the environment. Do not paste tokens into public issues or commits.

Optional BotFather settings (not required for V1):

- Disable groups if desired (bot already refuses non-private chats).
- Set a description/about text.

---

## 3. Get the code

If the working directory is **already** this repository, skip clone.

```bash
git clone https://github.com/dhaiiryar/pause-bot.git
cd pause-bot
git checkout master
```

Confirm layout:

- `package.json` with scripts `dev`, `start`, `test`, `typecheck`
- `src/index.ts` entrypoint
- `.env.example` documents env vars

---

## 4. Install dependencies

```bash
node -v   # expect v20+
npm install
```

If `better-sqlite3` fails to build, install system compilers (see §2), then re-run `npm install`.

---

## 5. Configure environment

### 5.1 Variables

| Name | Required | Default | Meaning |
|------|----------|---------|---------|
| `BOT_TOKEN` | **Yes** | — | Telegram bot token from BotFather |
| `DATABASE_PATH` | No | `./data/pause-bot.sqlite` | SQLite file path (parent dirs created automatically) |
| `SCHEDULER_INTERVAL_MS` | No | `15000` | How often the process checks for due Reminders (ms) |

### 5.2 Recommended local files

Create a local env file for the human’s convenience (optional reference):

```bash
cp .env.example .env
# Edit .env and set BOT_TOKEN=...
```

**Important:** `src/index.ts` reads `process.env` only. A `.env` file is **not** loaded automatically. Use one of:

**Option A — export in the shell (simple)**

```bash
export BOT_TOKEN='PASTE_TOKEN_HERE'
export DATABASE_PATH=./data/pause-bot.sqlite
export SCHEDULER_INTERVAL_MS=15000
```

**Option B — prefix the start command**

```bash
BOT_TOKEN='PASTE_TOKEN_HERE' DATABASE_PATH=./data/pause-bot.sqlite npm run dev
```

**Option C — load from `.env` without committing it** (bash):

```bash
set -a
# shellcheck disable=SC1091
source .env
set +a
npm run dev
```

Ensure `.env` is gitignored (it is in this repo’s `.gitignore`).

### 5.3 Validate token shape before start

- Non-empty
- Contains a `:` (typical BotFather format)
- Not the placeholder `123456:replace-with-token-from-BotFather`

If invalid, do not start; ask the user for a real token.

---

## 6. Verify (before starting the bot)

From the repo root:

```bash
npm test
npm run typecheck
```

Both must pass. If tests fail, **fix the failure** before starting Telegram integration; do not paper over with “it might still work.”

---

## 7. Start locally (development)

Preferred for local work (TypeScript via `tsx`, no build step):

```bash
# BOT_TOKEN must already be in the environment (see §5)
npm run dev
```

Expected log lines (approximate):

```text
Pause Bot starting (long polling). DB: /absolute/path/to/data/pause-bot.sqlite
Logged in as @your_bot_username
```

### 7.1 Production-style local start

```bash
npm run build
BOT_TOKEN='…' DATABASE_PATH=./data/pause-bot.sqlite npm start
```

### 7.2 Keep it running

- Run in a dedicated terminal, `tmux`/`screen`, or a process manager.
- Ctrl+C / SIGTERM should shut down cleanly (bot stop + SQLite close).
- Only **one** process should use the same `BOT_TOKEN` at a time (Telegram allows one getUpdates consumer; conflicts cause 409 / polling errors).

---

## 8. End-to-end smoke test (Telegram)

Perform with the user’s Telegram account in a **private** chat with the bot (search by `@username` from the start log).

### 8.1 Happy path setup

1. Send `/start`.
2. Expect a welcome message and **timezone** inline keyboard (common IANA zones + Other).
3. Tap a timezone (e.g. `UTC` or `Asia/Jakarta`), or follow Other → `/timezone Region/City`.
4. Expect **Active Window** presets (or custom `/window HH:MM HH:MM`).
5. Choose a window that **includes the current local time** if you want an immediate Reminder test (e.g. all-day `00:00–23:59`, or a window starting at the current half-hour).
6. Expect confirmation that **Eye Rest is on** and a status summary.
7. Send `/status` → timezone, window, Eye Rest on/off, 20-minute interval.

### 8.2 Commands checklist

| Action | Command / UI | Expected |
|--------|----------------|----------|
| Status | `/status` or Status button | Settings summary + menu |
| Pause pings | `/off` | Eye Rest off; settings kept |
| Resume | `/on` | Eye Rest on |
| Change window | `/window` or menu | Presets or `/window 09:00 18:00` |
| Change timezone | `/timezone` or menu | Picker or `/timezone Asia/Jakarta` |
| Wipe data | `/delete` → confirm | Data gone; `/start` runs setup again |

### 8.3 Reminder delivery check

1. Eye Rest **on**, setup complete, Active Window covers **now** in the User’s Timezone.
2. Wait until a **grid instant**: window start, then every 20 minutes (`:00`, plus 20, plus 40 from window start—not necessarily wall-clock `:00/:20/:40` unless the window starts on those minutes).
3. Within about `SCHEDULER_INTERVAL_MS` (default 15s) after that minute, the bot should send:

   > Eye rest — look ~20 feet / 6 metres away for 20 seconds. (20-20-20)

4. Fire-and-forget: no Done button required.

**Tip for agents:** To make a Reminder easier to observe, suggest Active Window start equal to the next upcoming 20-minute-aligned time in the User’s timezone, or use a short test window that starts at the current local HH:MM rounded down to a 20-minute offset from a chosen start.

### 8.4 Negative checks (optional)

| Case | Expected |
|------|----------|
| Message the bot from a **group** | Instructs to use a private chat; no group Reminders |
| Overnight window e.g. `22:00`–`06:00` | Rejected (same-day only, end after start) |
| Second process same token | Polling conflict / errors — stop the duplicate |

---

## 9. Troubleshooting

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| `Set BOT_TOKEN to your Telegram bot token` | Env not set; `.env` not loaded | Export `BOT_TOKEN` or prefix the command (§5) |
| `npm install` fails on `better-sqlite3` | Missing native toolchain | Install build-essential / Xcode CLT; reinstall |
| `npm test` fails | Broken tree or Node too old | Fix with Node 20+; do not start bot until green |
| 401 / unauthorized from Telegram | Bad or revoked token | New token from BotFather |
| 409 Conflict / getUpdates conflict | Another poller using same token | Kill other `node`/`tsx` pause-bot processes; no webhook left set |
| Bot starts but never replies | Wrong bot, or user in group | Confirm `@username`; use private chat |
| Setup works, no Reminders | Outside Active Window, Eye Rest off, or process died | `/status`; ensure process up; widen window; wait for grid minute |
| Reminders stopped after block | Permanent delivery failure auto-off | Unblock bot; `/on` or `/start` |
| DB path permission error | Cannot write `DATABASE_PATH` | Use a writable path e.g. `./data/pause-bot.sqlite` |

### 9.1 Clear local state

```bash
# Stop the bot first
rm -f ./data/pause-bot.sqlite ./data/pause-bot.sqlite-*
```

Or only wipe one User via Telegram: `/delete` (confirm).

### 9.2 Is anything still listening?

```bash
pgrep -af 'pause-bot|tsx src/index|node dist/index' || true
```

---

## 10. Ordered agent checklist (copy/paste)

Execute in order; stop on failure.

```text
[ ] Confirm Node 20+ and network access
[ ] Clone or use existing repo; cd to root; branch master (or current default)
[ ] npm install
[ ] Obtain BOT_TOKEN from user (do not invent)
[ ] Put BOT_TOKEN (and optional DATABASE_PATH) in the process environment
[ ] npm test
[ ] npm run typecheck
[ ] npm run dev  (leave running)
[ ] Confirm log: Logged in as @…
[ ] Ask user to /start in a private chat and confirm setup UI
[ ] (Optional) Complete setup + observe one Eye Rest Reminder inside Active Window
[ ] Report: repo path, @bot username, DATABASE_PATH, test results, any blockers
```

---

## 11. Out of scope (unless the user explicitly asks)

- Changing schedule rules, copy, or multi-activity features  
- Webhook mode, reverse proxies, or cloud deploy  
- Docker/systemd production hardening beyond a local always-on machine  
- Committing secrets or opening PRs  
- Load testing or multi-bot farms  

---

## 12. Quick reference

| Item | Value |
|------|--------|
| Public repo | https://github.com/dhaiiryar/pause-bot |
| Default branch | `master` |
| Dev start | `BOT_TOKEN=… npm run dev` |
| Prod-like start | `npm run build && BOT_TOKEN=… npm start` |
| Default DB | `./data/pause-bot.sqlite` |
| Default scheduler tick | 15_000 ms |
| V1 Activity | Eye Rest every 20 minutes in Active Window |
| Chat type | Private only |

Domain glossary: `CONTEXT.md`  
Architecture decisions: `docs/adr/`  
Human README: `README.md`
