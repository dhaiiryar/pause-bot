import Database from "better-sqlite3";
import {
  type ActivityId,
  defaultIntervalMinutes,
  ACTIVITY_IDS,
} from "../domain/activities.js";
import type { ActiveWindow } from "../domain/active-window.js";

export type ActivityState = {
  on: boolean;
  intervalMinutes: number;
  lastFireIso: string | null;
  snoozeUntilIso: string | null;
  latestReminderMessageId: number | null;
};

export type UserRecord = {
  telegramUserId: number;
  chatId: number;
  timezone: string | null;
  activeWindow: ActiveWindow | null;
  /** Weekend Active Window; null = same as weekdays. */
  weekendActiveWindow: ActiveWindow | null;
  /** Whether the User answered the weekend-window question. */
  weekendWindowSet: boolean;
  setupComplete: boolean;
  activities: Record<ActivityId, ActivityState>;
};

export class UserStore {
  private constructor(private readonly db: Database.Database) {}

  static open(path: string): UserStore {
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    const store = new UserStore(db);
    store.migrate();
    return store;
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_user_id INTEGER PRIMARY KEY,
        chat_id INTEGER NOT NULL,
        timezone TEXT,
        window_start_minutes INTEGER,
        window_end_minutes INTEGER
      );

      CREATE TABLE IF NOT EXISTS user_activities (
        telegram_user_id INTEGER NOT NULL,
        activity_id TEXT NOT NULL,
        is_on INTEGER NOT NULL DEFAULT 0,
        interval_minutes INTEGER NOT NULL,
        last_fire_iso TEXT,
        snooze_until_iso TEXT,
        latest_reminder_message_id INTEGER,
        PRIMARY KEY (telegram_user_id, activity_id),
        FOREIGN KEY (telegram_user_id) REFERENCES users(telegram_user_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS reminder_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_user_id INTEGER NOT NULL,
        activity_id TEXT NOT NULL,
        fire_iso TEXT NOT NULL,
        action TEXT,
        acted_at_iso TEXT,
        FOREIGN KEY (telegram_user_id) REFERENCES users(telegram_user_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_reminder_events_user_activity
        ON reminder_events(telegram_user_id, activity_id, fire_iso);
    `);
    this.ensureColumn("user_activities", "snooze_until_iso", "TEXT");
    this.ensureColumn(
      "user_activities",
      "latest_reminder_message_id",
      "INTEGER",
    );
    this.ensureColumn("users", "weekend_window_start_minutes", "INTEGER");
    this.ensureColumn("users", "weekend_window_end_minutes", "INTEGER");
    this.ensureColumn(
      "users",
      "weekend_window_set",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.backfillActivities();
  }

  /** Rows for newly added Activities for pre-existing Users (off by default). */
  private backfillActivities(): void {
    const users = this.db
      .prepare(`SELECT telegram_user_id FROM users`)
      .all() as Array<{ telegram_user_id: number }>;
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO user_activities
         (telegram_user_id, activity_id, is_on, interval_minutes)
       VALUES (?, ?, 0, ?)`,
    );
    for (const u of users) {
      for (const activityId of ACTIVITY_IDS) {
        insert.run(u.telegram_user_id, activityId, defaultIntervalMinutes(activityId));
      }
    }
  }

  private ensureColumn(
    table: string,
    column: string,
    type: string,
  ): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }

  ensureUser(telegramUserId: number, chatId: number): UserRecord {
    const existing = this.db
      .prepare(`SELECT telegram_user_id FROM users WHERE telegram_user_id = ?`)
      .get(telegramUserId) as { telegram_user_id: number } | undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO users (telegram_user_id, chat_id) VALUES (?, ?)`,
        )
        .run(telegramUserId, chatId);
      for (const activityId of ACTIVITY_IDS) {
        this.db
          .prepare(
            `INSERT INTO user_activities (telegram_user_id, activity_id, is_on, interval_minutes)
             VALUES (?, ?, 0, ?)`,
          )
          .run(
            telegramUserId,
            activityId,
            defaultIntervalMinutes(activityId),
          );
      }
    } else {
      this.db
        .prepare(`UPDATE users SET chat_id = ? WHERE telegram_user_id = ?`)
        .run(chatId, telegramUserId);
    }
    return this.getUser(telegramUserId)!;
  }

  getUser(telegramUserId: number): UserRecord | null {
    const row = this.db
      .prepare(
        `SELECT telegram_user_id, chat_id, timezone, window_start_minutes, window_end_minutes,
                weekend_window_start_minutes, weekend_window_end_minutes, weekend_window_set
         FROM users WHERE telegram_user_id = ?`,
      )
      .get(telegramUserId) as
      | {
          telegram_user_id: number;
          chat_id: number;
          timezone: string | null;
          window_start_minutes: number | null;
          window_end_minutes: number | null;
          weekend_window_start_minutes: number | null;
          weekend_window_end_minutes: number | null;
          weekend_window_set: number;
        }
      | undefined;

    if (!row) return null;

    const activityRows = this.db
      .prepare(
        `SELECT activity_id, is_on, interval_minutes, last_fire_iso,
                snooze_until_iso, latest_reminder_message_id
         FROM user_activities WHERE telegram_user_id = ?`,
      )
      .all(telegramUserId) as Array<{
      activity_id: string;
      is_on: number;
      interval_minutes: number;
      last_fire_iso: string | null;
      snooze_until_iso: string | null;
      latest_reminder_message_id: number | null;
    }>;

    const activities = {} as Record<ActivityId, ActivityState>;
    for (const id of ACTIVITY_IDS) {
      activities[id] = {
        on: false,
        intervalMinutes: defaultIntervalMinutes(id),
        lastFireIso: null,
        snoozeUntilIso: null,
        latestReminderMessageId: null,
      };
    }
    for (const a of activityRows) {
      if ((ACTIVITY_IDS as string[]).includes(a.activity_id)) {
        const id = a.activity_id as ActivityId;
        activities[id] = {
          on: a.is_on === 1,
          intervalMinutes: a.interval_minutes,
          lastFireIso: a.last_fire_iso,
          snoozeUntilIso: a.snooze_until_iso,
          latestReminderMessageId: a.latest_reminder_message_id,
        };
      }
    }

    const activeWindow =
      row.window_start_minutes !== null && row.window_end_minutes !== null
        ? {
            startMinutes: row.window_start_minutes,
            endMinutes: row.window_end_minutes,
          }
        : null;

    const weekendActiveWindow =
      row.weekend_window_start_minutes !== null &&
      row.weekend_window_end_minutes !== null
        ? {
            startMinutes: row.weekend_window_start_minutes,
            endMinutes: row.weekend_window_end_minutes,
          }
        : null;

    const setupComplete = row.timezone !== null && activeWindow !== null;

    return {
      telegramUserId: row.telegram_user_id,
      chatId: row.chat_id,
      timezone: row.timezone,
      activeWindow,
      weekendActiveWindow,
      weekendWindowSet: row.weekend_window_set === 1,
      setupComplete,
      activities,
    };
  }

  setTimezone(telegramUserId: number, timezone: string): void {
    this.withSetupAutoOn(telegramUserId, () => {
      this.db
        .prepare(`UPDATE users SET timezone = ? WHERE telegram_user_id = ?`)
        .run(timezone, telegramUserId);
      this.clearAllSnoozes(telegramUserId);
    });
  }

  setActiveWindow(telegramUserId: number, window: ActiveWindow): void {
    this.withSetupAutoOn(telegramUserId, () => {
      this.db
        .prepare(
          `UPDATE users SET window_start_minutes = ?, window_end_minutes = ?
           WHERE telegram_user_id = ?`,
        )
        .run(window.startMinutes, window.endMinutes, telegramUserId);
      this.clearAllSnoozes(telegramUserId);
    });
  }

  setWeekendWindow(
    telegramUserId: number,
    weekend: ActiveWindow | "same",
  ): void {
    this.withSetupAutoOn(telegramUserId, () => {
      if (weekend === "same") {
        this.db
          .prepare(
            `UPDATE users SET weekend_window_start_minutes = NULL,
                             weekend_window_end_minutes = NULL,
                             weekend_window_set = 1
             WHERE telegram_user_id = ?`,
          )
          .run(telegramUserId);
      } else {
        this.db
          .prepare(
            `UPDATE users SET weekend_window_start_minutes = ?,
                             weekend_window_end_minutes = ?,
                             weekend_window_set = 1
             WHERE telegram_user_id = ?`,
          )
          .run(weekend.startMinutes, weekend.endMinutes, telegramUserId);
      }
      this.clearAllSnoozes(telegramUserId);
    });
  }

  private clearAllSnoozes(telegramUserId: number): void {
    this.db
      .prepare(
        `UPDATE user_activities SET snooze_until_iso = NULL
         WHERE telegram_user_id = ?`,
      )
      .run(telegramUserId);
  }

  /** On first transition to setupComplete, turn all Activities on. Later config edits keep on/off. */
  private withSetupAutoOn(telegramUserId: number, mutate: () => void): void {
    const wasComplete = this.getUser(telegramUserId)?.setupComplete ?? false;
    mutate();
    const after = this.getUser(telegramUserId);
    if (!wasComplete && after?.setupComplete) {
      for (const activityId of ACTIVITY_IDS) {
        this.setActivityOn(telegramUserId, activityId, true);
      }
    }
  }

  setActivityOn(
    telegramUserId: number,
    activityId: ActivityId,
    on: boolean,
  ): void {
    if (on) {
      this.db
        .prepare(
          `UPDATE user_activities SET is_on = ? WHERE telegram_user_id = ? AND activity_id = ?`,
        )
        .run(1, telegramUserId, activityId);
    } else {
      this.db
        .prepare(
          `UPDATE user_activities SET is_on = 0, snooze_until_iso = NULL
           WHERE telegram_user_id = ? AND activity_id = ?`,
        )
        .run(telegramUserId, activityId);
    }
  }

  setIntervalMinutes(
    telegramUserId: number,
    activityId: ActivityId,
    intervalMinutes: number,
  ): void {
    this.db
      .prepare(
        `UPDATE user_activities SET interval_minutes = ?
         WHERE telegram_user_id = ? AND activity_id = ?`,
      )
      .run(intervalMinutes, telegramUserId, activityId);
  }

  setLastFireIso(
    telegramUserId: number,
    activityId: ActivityId,
    iso: string,
  ): void {
    this.db
      .prepare(
        `UPDATE user_activities SET last_fire_iso = ?
         WHERE telegram_user_id = ? AND activity_id = ?`,
      )
      .run(iso, telegramUserId, activityId);
  }

  setSnoozeUntilIso(
    telegramUserId: number,
    activityId: ActivityId,
    iso: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE user_activities SET snooze_until_iso = ?
         WHERE telegram_user_id = ? AND activity_id = ?`,
      )
      .run(iso, telegramUserId, activityId);
  }

  setLatestReminderMessageId(
    telegramUserId: number,
    activityId: ActivityId,
    messageId: number | null,
  ): void {
    this.db
      .prepare(
        `UPDATE user_activities SET latest_reminder_message_id = ?
         WHERE telegram_user_id = ? AND activity_id = ?`,
      )
      .run(messageId, telegramUserId, activityId);
  }

  recordReminderFired(
    telegramUserId: number,
    activityId: ActivityId,
    fireIso: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO reminder_events
           (telegram_user_id, activity_id, fire_iso, action, acted_at_iso)
         VALUES (?, ?, ?, NULL, NULL)`,
      )
      .run(telegramUserId, activityId, fireIso);
  }

  recordReminderAction(
    telegramUserId: number,
    activityId: ActivityId,
    fireIso: string,
    action: "done" | "snoozed",
    actedAtIso: string,
  ): void {
    const res = this.db
      .prepare(
        `UPDATE reminder_events SET action = ?, acted_at_iso = ?
         WHERE telegram_user_id = ? AND activity_id = ? AND fire_iso = ?`,
      )
      .run(action, actedAtIso, telegramUserId, activityId, fireIso);
    if (res.changes === 0) {
      // Defensive: Reminder fired before this table existed.
      this.db
        .prepare(
          `INSERT INTO reminder_events
             (telegram_user_id, activity_id, fire_iso, action, acted_at_iso)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(telegramUserId, activityId, fireIso, action, actedAtIso);
    }
  }

  listReminderEvents(
    telegramUserId: number,
    activityId: ActivityId,
    sinceIso: string,
  ): Array<{ fireIso: string; action: string | null }> {
    return (
      this.db
        .prepare(
          `SELECT fire_iso, action FROM reminder_events
           WHERE telegram_user_id = ? AND activity_id = ? AND fire_iso >= ?
           ORDER BY fire_iso`,
        )
        .all(telegramUserId, activityId, sinceIso) as Array<{
        fire_iso: string;
        action: string | null;
      }>
    ).map((r) => ({ fireIso: r.fire_iso, action: r.action }));
  }

  deleteUser(telegramUserId: number): void {
    this.db
      .prepare(`DELETE FROM users WHERE telegram_user_id = ?`)
      .run(telegramUserId);
  }

  listSchedulable(activityId: ActivityId): UserRecord[] {
    const rows = this.db
      .prepare(
        `SELECT u.telegram_user_id
         FROM users u
         JOIN user_activities a ON a.telegram_user_id = u.telegram_user_id
         WHERE a.activity_id = ?
           AND a.is_on = 1
           AND u.timezone IS NOT NULL
           AND u.window_start_minutes IS NOT NULL
           AND u.window_end_minutes IS NOT NULL`,
      )
      .all(activityId) as Array<{ telegram_user_id: number }>;

    return rows
      .map((r) => this.getUser(r.telegram_user_id))
      .filter((u): u is UserRecord => u !== null);
  }
}
