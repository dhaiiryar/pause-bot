export type ActiveWindow = {
  /** Minutes from local midnight, inclusive. */
  startMinutes: number;
  /** Minutes from local midnight, exclusive. */
  endMinutes: number;
};

export type ParseActiveWindowResult =
  | { ok: true; window: ActiveWindow }
  | { ok: false; error: string };

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseHhMm(value: string): number | null {
  const match = TIME_RE.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

export function parseActiveWindow(
  start: string,
  end: string,
): ParseActiveWindowResult {
  const startMinutes = parseHhMm(start);
  const endMinutes = parseHhMm(end);
  if (startMinutes === null || endMinutes === null) {
    return {
      ok: false,
      error: "Times must be HH:MM in 24-hour form (e.g. 09:00).",
    };
  }
  if (endMinutes <= startMinutes) {
    return {
      ok: false,
      error:
        "Active Window must be the same day: end must be after start (no overnight / midnight spans).",
    };
  }
  return { ok: true, window: { startMinutes, endMinutes } };
}

/** True if minute-of-day is in [start, end). */
export function windowContains(
  window: ActiveWindow,
  minutesFromMidnight: number,
): boolean {
  return (
    minutesFromMidnight >= window.startMinutes &&
    minutesFromMidnight < window.endMinutes
  );
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
