/**
 * Reminders dispatch pure helpers (quiet-hours + row parsing) — extracted
 * from reminders-dispatch.worker.ts to keep that file under the 800-line cap.
 *
 * Quiet-hours: SMS/WhatsApp are the intrusive channels here (they buzz a
 * phone), so only those are gated by the worker — email/Slack still deliver
 * immediately. When the owner's LOCAL time falls in the quiet window the row
 * is DEFERRED (re-queued, not failed, without consuming a retry attempt) and
 * re-checked shortly after.
 */

/** Normalize a drizzle/postgres-js execute result to a row array. Pure. */
export function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

/** Default IANA zone when an owner has no resolved timezone. */
export const DEFAULT_TIMEZONE = 'Africa/Dar_es_Salaam';

/** Re-evaluate a deferred row this often until it falls outside the window. */
export const QUIET_RECHECK_MS = 30 * 60_000; // 30m

/** Hour-of-day (0–23) at `instant` in the given IANA time zone. Pure. */
export function hourInZone(instant: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(instant);
    const raw = parts.find((p) => p.type === 'hour')?.value ?? '0';
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n % 24 : 0; // some engines render midnight as 24
  } catch {
    // Unknown/invalid time zone → treat as 0 so we never crash the dispatch.
    return 0;
  }
}

/**
 * True when `instant` is inside the quiet window `[startHour, endHour)` in
 * `timeZone`. Supports midnight-wrapping windows (e.g. 21→7). An empty window
 * (start === end) is treated as "no quiet hours". Pure.
 */
export function isWithinQuietHours(
  instant: Date,
  timeZone: string,
  startHour: number,
  endHour: number,
): boolean {
  if (startHour === endHour) return false;
  const h = hourInZone(instant, timeZone);
  return startHour < endHour
    ? h >= startHour && h < endHour
    : h >= startHour || h < endHour;
}
