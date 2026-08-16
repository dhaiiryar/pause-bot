export const EYE_REST_ACTIVITY_ID = "eye_rest" as const;
export const STRETCH_ACTIVITY_ID = "stretch_break" as const;

export type ActivityId =
  | typeof EYE_REST_ACTIVITY_ID
  | typeof STRETCH_ACTIVITY_ID;

export const EYE_REST_INTERVAL_MINUTES = 20;
export const STRETCH_INTERVAL_MINUTES = 60;

export const EYE_REST_SNOOZE_MINUTES = 5;

/** Preset Intervals a User may choose for an Activity (minutes). */
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

/** Rotating Stretch Break Reminder copy. */
export const STRETCH_MESSAGES = [
  "🧘 Stretch break — stand up, roll your shoulders and wrists, 30 seconds.",
  "🧘 Time to move — stand and stretch your arms overhead, 30 seconds.",
  "🧘 Posture reset — stand tall, squeeze your shoulder blades, 30 seconds.",
] as const;

/** User-facing Activity names. */
export const ACTIVITY_LABELS: Record<ActivityId, string> = {
  eye_rest: "Eye Rest",
  stretch_break: "Stretch Break",
};

/** All Reminder copy variants for an Activity. */
export function reminderMessages(activityId: ActivityId): readonly string[] {
  switch (activityId) {
    case EYE_REST_ACTIVITY_ID:
      return EYE_REST_MESSAGES;
    case STRETCH_ACTIVITY_ID:
      return STRETCH_MESSAGES;
    default: {
      const _exhaustive: never = activityId;
      return _exhaustive;
    }
  }
}

/** Picks which Reminder copy to send; injectable for deterministic tests. */
export type ReminderCopyPicker = (activityId: ActivityId) => string;

export function defaultReminderCopyPicker(activityId: ActivityId): string {
  const messages = reminderMessages(activityId);
  return messages[Math.floor(Math.random() * messages.length)]!;
}

export const ACTIVITY_IDS: ActivityId[] = [
  EYE_REST_ACTIVITY_ID,
  STRETCH_ACTIVITY_ID,
];

/** Narrows an untrusted string (e.g. callback data) to an ActivityId. */
export function isActivityId(value: string): value is ActivityId {
  return (ACTIVITY_IDS as string[]).includes(value);
}

export function defaultIntervalMinutes(activityId: ActivityId): number {
  switch (activityId) {
    case EYE_REST_ACTIVITY_ID:
      return EYE_REST_INTERVAL_MINUTES;
    case STRETCH_ACTIVITY_ID:
      return STRETCH_INTERVAL_MINUTES;
    default: {
      const _exhaustive: never = activityId;
      return _exhaustive;
    }
  }
}
