import Database from "better-sqlite3";
import {
  type ActivityId,
  EYE_REST_ACTIVITY_ID,
  defaultIntervalMinutes,
  ACTIVITY_IDS,
} from "../domain/activities.js";
import type { ActiveWindow } from "../domain/active-window.js";

export type ActivityState = {
  on: boolean;
  intervalMinutes: number;
  lastFireIso: string | null;
};

export type UserRecord = {
  telegramUserId: number;
  chatId: number;
  timezone: string | null;
  activeWindow: ActiveWindow | null;
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
        PRIMARY KEY (telegram_user_id, activity_id),
        FOREIGN KEY (telegram_user_id) REFERENCES users(telegram_user_id) ON DELETE CASCADE
      );
    `);
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
        `SELECT telegram_user_id, chat_id, timezone, window_start_minutes, window_end_minutes
         FROM users WHERE telegram_user_id = ?`,
      )
      .get(telegramUserId) as
      | {
          telegram_user_id: number;
          chat_id: number;
          timezone: string | null;
          window_start_minutes: number | null;
          window_end_minutes: number | null;
        }
      | undefined;

    if (!row) return null;

    const activityRows = this.db
      .prepare(
        `SELECT activity_id, is_on, interval_minutes, last_fire_iso
         FROM user_activities WHERE telegram_user_id = ?`,
      )
      .all(telegramUserId) as Array<{
      activity_id: string;
      is_on: number;
      interval_minutes: number;
      last_fire_iso: string | null;
    }>;

    const activities = {} as Record<ActivityId, ActivityState>;
    for (const id of ACTIVITY_IDS) {
      activities[id] = {
        on: false,
        intervalMinutes: defaultIntervalMinutes(id),
        lastFireIso: null,
      };
    }
    for (const a of activityRows) {
      if ((ACTIVITY_IDS as string[]).includes(a.activity_id)) {
        const id = a.activity_id as ActivityId;
        activities[id] = {
          on: a.is_on === 1,
          intervalMinutes: a.interval_minutes,
          lastFireIso: a.last_fire_iso,
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

    const setupComplete = row.timezone !== null && activeWindow !== null;

    return {
      telegramUserId: row.telegram_user_id,
      chatId: row.chat_id,
      timezone: row.timezone,
      activeWindow,
      setupComplete,
      activities,
    };
  }

  setTimezone(telegramUserId: number, timezone: string): void {
    this.withSetupAutoOn(telegramUserId, () => {
      this.db
        .prepare(`UPDATE users SET timezone = ? WHERE telegram_user_id = ?`)
        .run(timezone, telegramUserId);
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
    });
  }

  /** On first transition to setupComplete, turn Eye Rest on. Later config edits keep on/off. */
  private withSetupAutoOn(telegramUserId: number, mutate: () => void): void {
    const wasComplete = this.getUser(telegramUserId)?.setupComplete ?? false;
    mutate();
    const after = this.getUser(telegramUserId);
    if (!wasComplete && after?.setupComplete) {
      this.setActivityOn(telegramUserId, EYE_REST_ACTIVITY_ID, true);
    }
  }

  setActivityOn(
    telegramUserId: number,
    activityId: ActivityId,
    on: boolean,
  ): void {
    this.db
      .prepare(
        `UPDATE user_activities SET is_on = ? WHERE telegram_user_id = ? AND activity_id = ?`,
      )
      .run(on ? 1 : 0, telegramUserId, activityId);
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
