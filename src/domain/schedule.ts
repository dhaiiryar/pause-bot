import { DateTime } from "luxon";
import {
  type ActiveWindow,
  effectiveWindow,
  windowContains,
} from "./active-window.js";

export type ScheduleInput = {
  now: DateTime;
  window: ActiveWindow;
  /** Optional weekend Active Window; null/undefined = same as weekdays. */
  weekendWindow?: ActiveWindow | null;
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
      effectiveWindow(input.window, input.weekendWindow ?? null, day),
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
  const window = effectiveWindow(
    input.window,
    input.weekendWindow ?? null,
    local,
  );
  const minutes = minutesFromMidnight(local);
  if (!windowContains(window, minutes)) {
    return false;
  }
  const offset = minutes - window.startMinutes;
  return offset % input.intervalMinutes === 0;
}

export type SnoozeTargetInput = {
  now: DateTime;
  snoozeMinutes: number;
  window: ActiveWindow;
  /** Optional weekend Active Window; null/undefined = same as weekdays. */
  weekendWindow?: ActiveWindow | null;
  zone: string;
};

/** UTC ISO for delayed fire, or null if that instant is outside the Active Window. */
export function snoozeTargetIso(input: SnoozeTargetInput): string | null {
  const local = input.now
    .setZone(input.zone)
    .set({ second: 0, millisecond: 0 })
    .plus({ minutes: input.snoozeMinutes });
  const window = effectiveWindow(
    input.window,
    input.weekendWindow ?? null,
    local,
  );
  const minutes = minutesFromMidnight(local);
  if (!windowContains(window, minutes)) {
    return null;
  }
  return local.toUTC().toISO();
}

export type ReminderDueInput = ScheduleInput & {
  snoozeUntilIso: string | null;
  lastFireIso: string | null;
};

export type ReminderDueResult =
  | { due: false; clearSnooze: boolean }
  | { due: true; fireIso: string; clearSnooze: boolean };

/**
 * Whether a Reminder should fire now, honoring delay-only Snooze
 * (suppress grid while pending; fire at/after snooze time inside window).
 */
export function reminderDueAt(input: ReminderDueInput): ReminderDueResult {
  const local = localNow(input).set({ second: 0, millisecond: 0 });
  const fireIso = local.toUTC().toISO();
  if (!fireIso) {
    return { due: false, clearSnooze: false };
  }

  if (input.snoozeUntilIso) {
    const snoozeLocal = DateTime.fromISO(input.snoozeUntilIso, { zone: "utc" })
      .setZone(input.zone)
      .set({ second: 0, millisecond: 0 });
    if (local < snoozeLocal) {
      return { due: false, clearSnooze: false };
    }
    // Only fire on the same local day as the Snooze target; never resurrect next day.
    if (
      !local.hasSame(snoozeLocal, "day") ||
      !windowContains(
        effectiveWindow(input.window, input.weekendWindow ?? null, local),
        minutesFromMidnight(local),
      )
    ) {
      return { due: false, clearSnooze: true };
    }
    if (input.lastFireIso === fireIso) {
      return { due: false, clearSnooze: true };
    }
    return { due: true, fireIso, clearSnooze: true };
  }

  if (!firesDueAt(input)) {
    return { due: false, clearSnooze: false };
  }
  if (input.lastFireIso === fireIso) {
    return { due: false, clearSnooze: false };
  }
  return { due: true, fireIso, clearSnooze: false };
}
