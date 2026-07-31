import { IANAZone } from "luxon";
import {
  parseActiveWindow,
  formatMinutes,
} from "../domain/active-window.js";
import {
  EYE_REST_ACTIVITY_ID,
  EYE_REST_INTERVAL_MINUTES,
} from "../domain/activities.js";
import type { UserRecord, UserStore } from "../store/user-store.js";

export type ChatType = "private" | "group" | "supergroup" | "channel";

export type AppResult =
  | { kind: "private_only" }
  | { kind: "setup_timezone" }
  | { kind: "setup_window" }
  | { kind: "setup_complete"; user: UserRecord }
  | { kind: "status"; user: UserRecord }
  | { kind: "turned_on"; user: UserRecord }
  | { kind: "turned_off"; user: UserRecord }
  | { kind: "deleted" }
  | { kind: "need_setup" }
  | { kind: "error"; message: string };

export class BotApp {
  constructor(private readonly store: UserStore) {}

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

  deleteUser(telegramUserId: number): AppResult {
    this.store.deleteUser(telegramUserId);
    return { kind: "deleted" };
  }
}

export function formatStatus(user: UserRecord): string {
  const eye = user.activities[EYE_REST_ACTIVITY_ID];
  const window =
    user.activeWindow &&
    `${formatMinutes(user.activeWindow.startMinutes)}–${formatMinutes(user.activeWindow.endMinutes)}`;
  return [
    "Pause Bot status",
    `Timezone: ${user.timezone}`,
    `Active Window: ${window} (every day)`,
    `Eye Rest: ${eye.on ? "on" : "off"} every ${EYE_REST_INTERVAL_MINUTES} minutes`,
  ].join("\n");
}

export function formatSetupComplete(user: UserRecord): string {
  return [
    "You're set. Eye Rest is on.",
    formatStatus(user),
    "",
    "Reminders are fire-and-forget during your Active Window.",
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
