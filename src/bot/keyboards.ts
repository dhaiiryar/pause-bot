import { InlineKeyboard } from "grammy";
import { COMMON_TIMEZONES } from "./app.js";
import {
  EYE_REST_ACTIVITY_ID,
  EYE_REST_SNOOZE_MINUTES,
  VALID_INTERVAL_MINUTES,
} from "../domain/activities.js";

export function timezoneKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const zone of COMMON_TIMEZONES) {
    kb.text(zone, `tz:${zone}`).row();
  }
  kb.text("Other… (type /timezone Zone)", "tz:other");
  return kb;
}

export function mainMenuKeyboard(eyeRestOn: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (eyeRestOn) {
    kb.text("Turn Eye Rest off", "act:off");
  } else {
    kb.text("Turn Eye Rest on", "act:on");
  }
  kb.row();
  kb.text("Status", "act:status");
  kb.text("Stats", "act:stats");
  kb.text("Change window", "act:window");
  kb.text("Interval", "act:interval");
  kb.row();
  kb.text("Change timezone", "act:timezone");
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

export function intervalPresetsKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const m of VALID_INTERVAL_MINUTES) {
    kb.text(`${m} min`, `ivl:${m}`);
  }
  return kb;
}

export function reminderKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Done", `rem:done:${EYE_REST_ACTIVITY_ID}`)
    .text(
      `Snooze ${EYE_REST_SNOOZE_MINUTES} min`,
      `rem:snooze:${EYE_REST_ACTIVITY_ID}`,
    );
}

/** Telegram shape that removes inline buttons from a message. */
export function emptyReplyMarkup(): { inline_keyboard: [] } {
  return { inline_keyboard: [] };
}
