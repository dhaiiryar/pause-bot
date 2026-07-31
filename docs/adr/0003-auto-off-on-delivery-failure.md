# Auto-off on permanent delivery failure

If Telegram reports a permanent send failure (e.g. user blocked the bot or chat is gone), turn the User's Activities off and keep their settings. That stops useless retries without wiping config, so a returning User can turn Activities on again without full re-setup. Transient API errors are retried; they do not off or delete.
