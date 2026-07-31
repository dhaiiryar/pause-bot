import { DateTime } from "luxon";
import {
  type ActiveWindow,
  windowContains,
} from "./active-window.js";

export type ScheduleInput = {
  now: DateTime;
  window: ActiveWindow;
  intervalMinutes: number;
  zone: string;
};

function localNow(input: ScheduleInput): DateTime {
  return input.now.setZone(input.zone);
}

function minutesFromMidnight(dt: DateTime): number {
  return dt.hour * 60 + dt.minute;
}

function atLocalMinutes(day: DateTime, minutes: number): DateTime {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return day.set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });
}

/** Grid slots for a local calendar day: start, start+interval, … while still inside window. */
export function gridSlotsForDay(
  day: DateTime,
  window: ActiveWindow,
  intervalMinutes: number,
): DateTime[] {
  const slots: DateTime[] = [];
  for (
    let m = window.startMinutes;
    m < window.endMinutes;
    m += intervalMinutes
  ) {
    if (!windowContains(window, m)) break;
    slots.push(atLocalMinutes(day, m));
  }
  return slots;
}

/** Next fire at or after `now` (if `now` is exactly on a slot, returns `now` truncated to minute for nextFire — actually next after now for scheduling). */
export function nextFireAt(input: ScheduleInput): DateTime | null {
  const local = localNow(input);
  const startDay = local.startOf("day");

  for (let dayOffset = 0; dayOffset < 366; dayOffset++) {
    const day = startDay.plus({ days: dayOffset });
    const slots = gridSlotsForDay(
      day,
      input.window,
      input.intervalMinutes,
    );
    for (const slot of slots) {
      if (slot >= local) {
        return slot;
      }
    }
  }
  return null;
}

/** Whether a Reminder should fire at this instant (minute precision on the grid). */
export function firesDueAt(input: ScheduleInput): boolean {
  const local = localNow(input).set({ second: 0, millisecond: 0 });
  const minutes = minutesFromMidnight(local);
  if (!windowContains(input.window, minutes)) {
    return false;
  }
  const offset = minutes - input.window.startMinutes;
  return offset % input.intervalMinutes === 0;
}
