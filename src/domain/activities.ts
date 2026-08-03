export const EYE_REST_ACTIVITY_ID = "eye_rest" as const;

export type ActivityId = typeof EYE_REST_ACTIVITY_ID;

export const EYE_REST_INTERVAL_MINUTES = 20;

export const EYE_REST_SNOOZE_MINUTES = 5;

export const EYE_REST_MESSAGE =
  "👁 Eye rest — look ~20 feet / 6 metres away for 20 seconds. (20-20-20)";

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
