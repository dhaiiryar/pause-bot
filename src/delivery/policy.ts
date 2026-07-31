export type TelegramApiErrorShape = {
  error_code?: number;
  description?: string;
};

/**
 * Permanent failures → auto-off Activities, keep settings (ADR-0003).
 * Transient failures → retry later; do not off or delete.
 */
export function isPermanentDeliveryFailure(
  err: TelegramApiErrorShape | string | unknown,
): boolean {
  if (typeof err === "string") {
    return matchesPermanentText(err);
  }
  if (err && typeof err === "object") {
    const e = err as TelegramApiErrorShape & { message?: string };
    const description = e.description ?? e.message ?? "";
    if (e.error_code === 403) return true;
    if (e.error_code === 400 && matchesPermanentText(description)) return true;
    if (matchesPermanentText(description)) return true;
  }
  return false;
}

function matchesPermanentText(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("blocked by the user") ||
    t.includes("user is deactivated") ||
    t.includes("chat not found") ||
    t.includes("bot was kicked") ||
    t.includes("forbidden")
  );
}
