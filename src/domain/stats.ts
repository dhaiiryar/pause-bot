import { DateTime } from "luxon";

export type ReminderEventRow = {
  fireIso: string;
  action: string | null;
};

export type AdherenceStats = {
  todayFires: number;
  todayDone: number;
  weekFires: number;
  weekDone: number;
  weekSnoozed: number;
  streak: number;
};

export function computeAdherenceStats(input: {
  events: ReminderEventRow[];
  now: DateTime;
  zone: string;
}): AdherenceStats {
  const localNow = input.now.setZone(input.zone);
  const today = localNow.startOf("day");
  const weekStart = today.minus({ days: 6 });

  const rows = input.events
    .map((e) => ({
      action: e.action,
      local: DateTime.fromISO(e.fireIso, { zone: "utc" }).setZone(input.zone),
    }))
    .filter((r) => r.local.isValid && r.local >= weekStart);

  const inDay = (r: { local: DateTime }) => r.local.hasSame(today, "day");

  const done = (r: { action: string | null }) => r.action === "done";
  const snoozed = (r: { action: string | null }) => r.action === "snoozed";

  // Newest fire first; streak = leading run of done fires.
  const sorted = [...rows].sort((a, b) => b.local.toMillis() - a.local.toMillis());
  let streak = 0;
  for (const r of sorted) {
    if (!done(r)) break;
    streak += 1;
  }

  return {
    todayFires: rows.filter(inDay).length,
    todayDone: rows.filter(inDay).filter(done).length,
    weekFires: rows.length,
    weekDone: rows.filter(done).length,
    weekSnoozed: rows.filter(snoozed).length,
    streak,
  };
}

export function formatAdherence(
  activityLabel: string,
  stats: AdherenceStats,
): string {
  const pct = (n: number, d: number) =>
    d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
  const today =
    stats.todayFires === 0
      ? "Today: no Reminders yet"
      : `Today: ${stats.todayFires} Reminder${stats.todayFires === 1 ? "" : "s"}, ${stats.todayDone} Done (${pct(stats.todayDone, stats.todayFires)})`;
  const week =
    stats.weekFires === 0
      ? "Last 7 days: no Reminders yet"
      : `Last 7 days: ${stats.weekFires} Reminder${stats.weekFires === 1 ? "" : "s"}, ${stats.weekDone} Done (${pct(stats.weekDone, stats.weekFires)}), ${stats.weekSnoozed} Snoozed`;
  return [
    `${activityLabel} stats`,
    today,
    week,
    `Streak: ${stats.streak} Done in a row`,
  ].join("\n");
}
