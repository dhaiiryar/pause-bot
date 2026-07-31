import { DateTime } from "luxon";
import type { Bot } from "grammy";
import { GrammyError } from "grammy";
import {
  EYE_REST_ACTIVITY_ID,
  EYE_REST_MESSAGE,
} from "../domain/activities.js";
import { firesDueAt } from "../domain/schedule.js";
import { isPermanentDeliveryFailure } from "../delivery/policy.js";
import type { UserStore } from "../store/user-store.js";

export type Clock = () => DateTime;

export async function tickReminders(options: {
  store: UserStore;
  bot: Bot;
  now?: Clock;
}): Promise<{ sent: number; autoOff: number }> {
  const now = (options.now ?? (() => DateTime.utc()))();
  const users = options.store.listSchedulable(EYE_REST_ACTIVITY_ID);
  let sent = 0;
  let autoOff = 0;

  for (const user of users) {
    if (!user.timezone || !user.activeWindow) continue;
    const activity = user.activities[EYE_REST_ACTIVITY_ID];
    const due = firesDueAt({
      now,
      window: user.activeWindow,
      intervalMinutes: activity.intervalMinutes,
      zone: user.timezone,
    });
    if (!due) continue;

    const fireIso = now
      .setZone(user.timezone)
      .set({ second: 0, millisecond: 0 })
      .toUTC()
      .toISO();
    if (!fireIso) continue;
    if (activity.lastFireIso === fireIso) continue;

    try {
      await options.bot.api.sendMessage(user.chatId, EYE_REST_MESSAGE);
      options.store.setLastFireIso(
        user.telegramUserId,
        EYE_REST_ACTIVITY_ID,
        fireIso,
      );
      sent += 1;
    } catch (err) {
      if (isPermanentFromUnknown(err)) {
        options.store.setActivityOn(
          user.telegramUserId,
          EYE_REST_ACTIVITY_ID,
          false,
        );
        autoOff += 1;
      }
      // transient: leave on, try next tick
    }
  }

  return { sent, autoOff };
}

function isPermanentFromUnknown(err: unknown): boolean {
  if (err instanceof GrammyError) {
    return isPermanentDeliveryFailure({
      error_code: err.error_code,
      description: err.description,
    });
  }
  if (err && typeof err === "object" && "error_code" in err) {
    return isPermanentDeliveryFailure(err);
  }
  if (err instanceof Error) {
    return isPermanentDeliveryFailure(err.message);
  }
  return isPermanentDeliveryFailure(err);
}
