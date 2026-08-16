export const EYE_REST_ACTIVITY_ID = "eye_rest" as const;

export type ActivityId = typeof EYE_REST_ACTIVITY_ID;

export const EYE_REST_INTERVAL_MINUTES = 20;

export const EYE_REST_SNOOZE_MINUTES = 5;

/** Preset Intervals a User may choose for Eye Rest (minutes). */
export const VALID_INTERVAL_MINUTES = [10, 15, 20, 30, 45, 60] as const;

/** Rotating Eye Rest Reminder copy; variant 0 is the classic message. */
export const EYE_REST_MESSAGES = [
  "👁 Eye rest — look ~20 feet / 6 metres away for 20 seconds. (20-20-20)",
  "👁 Pause: let your eyes rest on something ~6 m away for 20 seconds.",
  "👀 Soften your gaze — find a distant point and hold it for 20 seconds.",
  "🖥️ → 🌅 Look away from the screen, ~6 m out, for a 20-second breather.",
  "👁 Micro-break: blink slowly, look far, 20 seconds. Your eyes earn it.",
  "⏸️ 20-second reset: unwind your focus onto something far away.",
] as const;

/** Kept for compatibility: the classic single message. */
export const EYE_REST_MESSAGE = EYE_REST_MESSAGES[0];

/** Picks which Reminder copy to send; injectable for deterministic tests. */
export type ReminderCopyPicker = () => string;

export function defaultReminderCopyPicker(): string {
  return EYE_REST_MESSAGES[
    Math.floor(Math.random() * EYE_REST_MESSAGES.length)
  ]!;
}

export const ACTIVITY_IDS: ActivityId[] = [EYE_REST_ACTIVITY_ID];

export function defaultIntervalMinutes(activityId: ActivityId): number {
  switch (activityId) {
    case EYE_REST_ACTIVITY_ID:
      return EYE_REST_INTERVAL_MINUTES;
    default: {
      const _exhaustive: never = activityId;
      return _exhaustive;
    }
  }
}
