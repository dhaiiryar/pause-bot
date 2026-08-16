import { InlineKeyboard } from "grammy";
import { COMMON_TIMEZONES } from "./app.js";
import {
  ACTIVITY_IDS,
  ACTIVITY_LABELS,
  EYE_REST_ACTIVITY_ID,
  EYE_REST_SNOOZE_MINUTES,
  VALID_INTERVAL_MINUTES,
  type ActivityId,
} from "../domain/activities.js";
import type { ActivityState } from "../store/user-store.js";

export function timezoneKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const zone of COMMON_TIMEZONES) {
    kb.text(zone, `tz:${zone}`).row();
  }
  kb.text("Other… (type /timezone Zone)", "tz:other");
  return kb;
}

export function mainMenuKeyboard(
  activities: Record<ActivityId, ActivityState>,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const id of ACTIVITY_IDS) {
    const state = activities[id];
    kb.text(
      `${ACTIVITY_LABELS[id]}: ${state.on ? "on" : "off"}`,
      `act:toggle:${id}`,
    ).row();
  }
  kb.text("Status", "act:status");
  kb.text("Stats", "act:stats");
  kb.row();
  kb.text("Change window", "act:window");
  kb.text("Change timezone", "act:timezone");
  kb.row();
  kb.text("Interval", "act:interval");
  kb.text("Delete my data", "act:delete_confirm");
  return kb;
}

export function deleteConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes, delete everything", "act:delete")
    .text("Cancel", "act:status");
}

export function windowPresetsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("09:00–18:00", "win:09:00-18:00")
    .row()
    .text("08:00–17:00", "win:08:00-17:00")
    .row()
    .text("10:00–19:00", "win:10:00-19:00")
    .row()
    .text("00:00–23:59 (all day)", "win:00:00-23:59")
    .row()
    .text("Custom: /window HH:MM HH:MM", "win:custom");
}

export function intervalPresetsKeyboard(
  activityId: ActivityId,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const m of VALID_INTERVAL_MINUTES) {
    kb.text(`${m} min`, `ivl:${activityId}:${m}`);
  }
  return kb;
}

/** Asks which Activity a scoped action (e.g. interval) applies to. */
export function activityChooserKeyboard(prefix: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const id of ACTIVITY_IDS) {
    kb.text(ACTIVITY_LABELS[id], `${prefix}${id}`).row();
  }
  return kb;
}

export function reminderKeyboard(activityId: ActivityId): InlineKeyboard {
  const snooze = activityId === EYE_REST_ACTIVITY_ID
    ? EYE_REST_SNOOZE_MINUTES
    : 5;
  return new InlineKeyboard()
    .text("Done", `rem:done:${activityId}`)
    .text(`Snooze ${snooze} min`, `rem:snooze:${activityId}`);
}

/** Telegram shape that removes inline buttons from a message. */
export function emptyReplyMarkup(): { inline_keyboard: [] } {
  return { inline_keyboard: [] };
}
