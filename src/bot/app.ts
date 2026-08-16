import { DateTime, IANAZone } from "luxon";
import {
  parseActiveWindow,
  formatMinutes,
} from "../domain/active-window.js";
import {
  EYE_REST_ACTIVITY_ID,
  EYE_REST_SNOOZE_MINUTES,
  VALID_INTERVAL_MINUTES,
  type ActivityId,
} from "../domain/activities.js";
import { snoozeTargetIso } from "../domain/schedule.js";
import {
  computeAdherenceStats,
  type AdherenceStats,
} from "../domain/stats.js";
import type { UserRecord, UserStore } from "../store/user-store.js";

export type ChatType = "private" | "group" | "supergroup" | "channel";

export type Clock = () => DateTime;

export type AppResult =
  | { kind: "private_only" }
  | { kind: "setup_timezone" }
  | { kind: "setup_window" }
  | { kind: "setup_complete"; user: UserRecord }
  | { kind: "status"; user: UserRecord }
  | { kind: "turned_on"; user: UserRecord }
  | { kind: "turned_off"; user: UserRecord }
  | { kind: "interval_set"; user: UserRecord }
  | { kind: "stats"; user: UserRecord; stats: AdherenceStats }
  | { kind: "deleted" }
  | { kind: "need_setup" }
  | { kind: "error"; message: string };

export type ReminderActionResult =
  | { kind: "done"; stripMessageId: number }
  | { kind: "snoozed"; stripMessageId: number; minutes: number }
  | { kind: "snooze_outside_window"; stripMessageId: number }
  | { kind: "stale" }
  | { kind: "need_setup" }
  | { kind: "error"; message: string };

export class BotApp {
  constructor(
    private readonly store: UserStore,
    private readonly now: Clock = () => DateTime.utc(),
  ) {}

  onStart(input: {
    telegramUserId: number;
    chatId: number;
    chatType: ChatType;
  }): AppResult {
    if (input.chatType !== "private") {
      return { kind: "private_only" };
    }
    const user = this.store.ensureUser(input.telegramUserId, input.chatId);
    if (!user.setupComplete) {
      if (!user.timezone) return { kind: "setup_timezone" };
      return { kind: "setup_window" };
    }
    return { kind: "status", user };
  }

  setTimezone(telegramUserId: number, timezone: string): AppResult {
    if (!IANAZone.isValidZone(timezone)) {
      return {
        kind: "error",
        message: `Unknown timezone "${timezone}". Use an IANA name like Asia/Jakarta.`,
      };
    }
    this.store.setTimezone(telegramUserId, timezone);
    const user = this.store.getUser(telegramUserId);
    if (user?.setupComplete) {
      return { kind: "status", user };
    }
    return { kind: "setup_window" };
  }

  setActiveWindow(
    telegramUserId: number,
    start: string,
    end: string,
  ): AppResult {
    const parsed = parseActiveWindow(start, end);
    if (!parsed.ok) {
      return { kind: "error", message: parsed.error };
    }
    const before = this.store.getUser(telegramUserId);
    const wasComplete = before?.setupComplete ?? false;
    this.store.setActiveWindow(telegramUserId, parsed.window);
    const user = this.store.getUser(telegramUserId)!;
    if (!wasComplete && user.setupComplete) {
      return { kind: "setup_complete", user };
    }
    if (!user.setupComplete) {
      return { kind: "setup_timezone" };
    }
    return { kind: "status", user };
  }

  status(telegramUserId: number): AppResult {
    const user = this.store.getUser(telegramUserId);
    if (!user?.setupComplete) return { kind: "need_setup" };
    return { kind: "status", user };
  }

  turnOn(telegramUserId: number): AppResult {
    const user = this.store.getUser(telegramUserId);
    if (!user?.setupComplete) return { kind: "need_setup" };
    this.store.setActivityOn(telegramUserId, EYE_REST_ACTIVITY_ID, true);
    return { kind: "turned_on", user: this.store.getUser(telegramUserId)! };
  }

  turnOff(telegramUserId: number): AppResult {
    const user = this.store.getUser(telegramUserId);
    if (!user?.setupComplete) return { kind: "need_setup" };
    this.store.setActivityOn(telegramUserId, EYE_REST_ACTIVITY_ID, false);
    return { kind: "turned_off", user: this.store.getUser(telegramUserId)! };
  }

  setInterval(telegramUserId: number, minutes: number): AppResult {
    const user = this.store.getUser(telegramUserId);
    if (!user?.setupComplete) return { kind: "need_setup" };
    if (!(VALID_INTERVAL_MINUTES as readonly number[]).includes(minutes)) {
      return {
        kind: "error",
        message: `Interval must be one of: ${VALID_INTERVAL_MINUTES.join(", ")} minutes.`,
      };
    }
    this.store.setIntervalMinutes(
      telegramUserId,
      EYE_REST_ACTIVITY_ID,
      minutes,
    );
    return {
      kind: "interval_set",
      user: this.store.getUser(telegramUserId)!,
    };
  }

  deleteUser(telegramUserId: number): AppResult {
    this.store.deleteUser(telegramUserId);
    return { kind: "deleted" };
  }

  stats(telegramUserId: number): AppResult {
    const user = this.store.getUser(telegramUserId);
    if (!user?.setupComplete || !user.timezone) return { kind: "need_setup" };
    const since = this.now()
      .toUTC()
      .minus({ days: 8 })
      .startOf("minute")
      .toISO()!;
    const events = this.store.listReminderEvents(
      telegramUserId,
      EYE_REST_ACTIVITY_ID,
      since,
    );
    const stats = computeAdherenceStats({
      events,
      now: this.now(),
      zone: user.timezone,
    });
    return { kind: "stats", user, stats };
  }

  doneReminder(
    telegramUserId: number,
    activityId: ActivityId,
    messageId: number,
  ): ReminderActionResult {
    return this.withLatestReminder(
      telegramUserId,
      activityId,
      messageId,
      (user) => {
        this.recordReminderAction(user, activityId, "done");
        return { kind: "done", stripMessageId: messageId };
      },
    );
  }

  snoozeReminder(
    telegramUserId: number,
    activityId: ActivityId,
    messageId: number,
  ): ReminderActionResult {
    return this.withLatestReminder(
      telegramUserId,
      activityId,
      messageId,
      (user) => {
        if (!user.timezone || !user.activeWindow) {
          return { kind: "need_setup" };
        }
        const target = snoozeTargetIso({
          now: this.now(),
          snoozeMinutes: EYE_REST_SNOOZE_MINUTES,
          window: user.activeWindow,
          zone: user.timezone,
        });
        if (!target) {
          return {
            kind: "snooze_outside_window",
            stripMessageId: messageId,
          };
        }
        this.recordReminderAction(user, activityId, "snoozed");
        this.store.setSnoozeUntilIso(telegramUserId, activityId, target);
        return {
          kind: "snoozed",
          stripMessageId: messageId,
          minutes: EYE_REST_SNOOZE_MINUTES,
        };
      },
    );
  }

  private recordReminderAction(
    user: UserRecord,
    activityId: ActivityId,
    action: "done" | "snoozed",
  ): void {
    const activity = user.activities[activityId];
    if (activity.lastFireIso) {
      this.store.recordReminderAction(
        user.telegramUserId,
        activityId,
        activity.lastFireIso,
        action,
        this.now().toUTC().toISO() ?? "",
      );
    }
  }

  private withLatestReminder(
    telegramUserId: number,
    activityId: ActivityId,
    messageId: number,
    act: (user: UserRecord) => ReminderActionResult,
  ): ReminderActionResult {
    const user = this.store.getUser(telegramUserId);
    if (!user?.setupComplete) return { kind: "need_setup" };
    const activity = user.activities[activityId];
    if (activity == null) {
      return { kind: "error", message: "Unknown activity." };
    }
    if (activity.latestReminderMessageId !== messageId) {
      return { kind: "stale" };
    }
    if (!activity.on) {
      return { kind: "error", message: "Eye Rest is off." };
    }
    return act(user);
  }
}

export { formatAdherence } from "../domain/stats.js";

export function formatStatus(user: UserRecord): string {
  const eye = user.activities[EYE_REST_ACTIVITY_ID];
  const window =
    user.activeWindow &&
    `${formatMinutes(user.activeWindow.startMinutes)}–${formatMinutes(user.activeWindow.endMinutes)}`;
  return [
    "Pause Bot status",
    `Timezone: ${user.timezone}`,
    `Active Window: ${window} (every day)`,
    `Eye Rest: ${eye.on ? "on" : "off"} every ${eye.intervalMinutes} minutes`,
  ].join("\n");
}

export function formatSetupComplete(user: UserRecord): string {
  return [
    "You're set. Eye Rest is on.",
    formatStatus(user),
    "",
    "Reminders offer Done and Snooze during your Active Window.",
    "Commands: /status /off /on /window /timezone /delete",
  ].join("\n");
}

/** Common zones offered as buttons. */
export const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;
