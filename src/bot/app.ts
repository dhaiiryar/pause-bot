import { DateTime, IANAZone } from "luxon";
import {
  type ActiveWindow,
  parseActiveWindow,
  formatMinutes,
} from "../domain/active-window.js";
import {
  ACTIVITY_IDS,
  ACTIVITY_LABELS,
  EYE_REST_ACTIVITY_ID,
  EYE_REST_SNOOZE_MINUTES,
  STRETCH_ACTIVITY_ID,
  VALID_INTERVAL_MINUTES,
  isActivityId,
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
  | { kind: "setup_weekend" }
  | { kind: "setup_complete"; user: UserRecord }
  | { kind: "status"; user: UserRecord }
  | { kind: "turned_on"; user: UserRecord }
  | { kind: "turned_off"; user: UserRecord }
  | { kind: "interval_set"; user: UserRecord; activityId: ActivityId }
  | {
      kind: "stats";
      user: UserRecord;
      statsByActivity: Record<ActivityId, AdherenceStats>;
    }
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
      if (!user.weekendWindowSet) {
        return { kind: "setup_weekend" };
      }
      return { kind: "setup_complete", user };
    }
    if (!user.setupComplete) {
      return { kind: "setup_timezone" };
    }
    return { kind: "status", user };
  }

  setWeekendWindow(
    telegramUserId: number,
    weekend: ActiveWindow | "same",
  ): AppResult {
    const before = this.store.getUser(telegramUserId);
    if (!before?.setupComplete) {
      return { kind: "need_setup" };
    }
    this.store.setWeekendWindow(telegramUserId, weekend);
    const user = this.store.getUser(telegramUserId)!;
    if (!before.weekendWindowSet) {
      return { kind: "setup_complete", user };
    }
    return { kind: "status", user };
  }

  setWeekendWindowStrings(
    telegramUserId: number,
    start: string,
    end: string,
  ): AppResult {
    const parsed = parseActiveWindow(start, end);
    if (!parsed.ok) {
      return { kind: "error", message: parsed.error };
    }
    return this.setWeekendWindow(telegramUserId, parsed.window);
  }

  status(telegramUserId: number): AppResult {
    const user = this.store.getUser(telegramUserId);
    if (!user?.setupComplete) return { kind: "need_setup" };
    return { kind: "status", user };
  }

  turnOn(telegramUserId: number, scope: ActivityScope): AppResult {
    const user = this.store.getUser(telegramUserId);
    if (!user?.setupComplete) return { kind: "need_setup" };
    const targets = scope === "all" ? ACTIVITY_IDS : [scope];
    for (const id of targets) {
      this.store.setActivityOn(telegramUserId, id, true);
    }
    return { kind: "turned_on", user: this.store.getUser(telegramUserId)! };
  }

  turnOff(telegramUserId: number, scope: ActivityScope): AppResult {
    const user = this.store.getUser(telegramUserId);
    if (!user?.setupComplete) return { kind: "need_setup" };
    const targets = scope === "all" ? ACTIVITY_IDS : [scope];
    for (const id of targets) {
      this.store.setActivityOn(telegramUserId, id, false);
    }
    return { kind: "turned_off", user: this.store.getUser(telegramUserId)! };
  }

  setInterval(
    telegramUserId: number,
    minutes: number,
    activityId: ActivityId,
  ): AppResult {
    const user = this.store.getUser(telegramUserId);
    if (!user?.setupComplete) return { kind: "need_setup" };
    if (!isActivityId(activityId)) {
      return { kind: "error", message: "Unknown activity." };
    }
    if (!(VALID_INTERVAL_MINUTES as readonly number[]).includes(minutes)) {
      return {
        kind: "error",
        message: `Interval must be one of: ${VALID_INTERVAL_MINUTES.join(", ")} minutes.`,
      };
    }
    this.store.setIntervalMinutes(telegramUserId, activityId, minutes);
    return {
      kind: "interval_set",
      user: this.store.getUser(telegramUserId)!,
      activityId,
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
    const statsByActivity = {} as Record<ActivityId, AdherenceStats>;
    for (const id of ACTIVITY_IDS) {
      const events = this.store.listReminderEvents(telegramUserId, id, since);
      statsByActivity[id] = computeAdherenceStats({
        events,
        now: this.now(),
        zone: user.timezone,
      });
    }
    return { kind: "stats", user, statsByActivity };
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
          weekendWindow: user.weekendActiveWindow,
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
      return { kind: "error", message: `${ACTIVITY_LABELS[activityId]} is off.` };
    }
    return act(user);
  }
}

export { formatAdherence } from "../domain/stats.js";

export function formatStatus(user: UserRecord): string {
  const window =
    user.activeWindow &&
    `${formatMinutes(user.activeWindow.startMinutes)}–${formatMinutes(user.activeWindow.endMinutes)}`;
  const weekend = user.weekendActiveWindow;
  const weekendLine = `Weekend: ${
    weekend === null
      ? "same as weekdays"
      : weekend.startMinutes === 0 && weekend.endMinutes === 0
        ? "off"
        : `${formatMinutes(weekend.startMinutes)}–${formatMinutes(weekend.endMinutes)}`
  }`;
  const activityLines = ACTIVITY_IDS.map(
    (id) =>
      `${ACTIVITY_LABELS[id]}: ${user.activities[id].on ? "on" : "off"} every ${user.activities[id].intervalMinutes} minutes`,
  );
  return [
    "Pause Bot status",
    `Timezone: ${user.timezone}`,
    `Active Window: ${window} (Mon–Fri)`,
    weekendLine,
    ...activityLines,
  ].join("\n");
}

export function formatSetupComplete(user: UserRecord): string {
  return [
    "You're set. Your activities are on.",
    formatStatus(user),
    "",
    "Reminders offer Done and Snooze during your Active Window.",
    "Commands: /status /off /on /window /timezone /delete",
  ].join("\n");
}

export type ActivityScope = ActivityId | "all";

/** Maps a /on, /off, /interval keyword to its Activity (no keyword = all). */
export function parseActivityScope(
  keyword: string | undefined,
): ActivityScope | null {
  if (!keyword) return "all";
  const k = keyword.trim().toLowerCase();
  if (k === "eyes" || k === "eye") return EYE_REST_ACTIVITY_ID;
  if (k === "stretch") return STRETCH_ACTIVITY_ID;
  return null;
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
