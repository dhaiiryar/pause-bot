import { InlineKeyboard } from "grammy";
import { COMMON_TIMEZONES } from "./app.js";

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
  kb.text("Change window", "act:window");
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
