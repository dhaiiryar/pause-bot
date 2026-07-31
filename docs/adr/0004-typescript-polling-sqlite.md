# TypeScript, long polling, SQLite

V1 is a single Node/TypeScript process using long polling against Telegram and SQLite for User settings and schedule state. That minimizes ops (no public webhook URL, no separate DB service) while the product is still small. Webhook + Postgres is the expected path if we need multiple instances or a stable public endpoint.
