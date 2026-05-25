/**
 * Handle the ambiguous fall-back hour.
 *
 * Example: `America/New_York` on 2026-11-01 — 01:00..02:00 EDT happens,
 * then the clock falls back to 01:00 EST. The wall-clock string
 * "01:30" maps to TWO different UTC instants. Callers must declare
 * whether they prefer the EARLIER (still-summer-time) or the LATER
 * (already-standard-time) interpretation.
 */

import type { TimezoneId } from '../types.js';
import { timezoneOffsetMinutes } from './offset.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Given an ambiguous wall-clock instant `date` (which lies inside the
 * fall-back overlap), return the UTC instant matching `prefer`.
 *
 * The fall-back window has TWO UTC instants that both render to the
 * same wall-clock string. We always normalise to a deterministic pair:
 *   - `earlier`: the still-DST instant (one offset hour ago)
 *   - `later`:   the post-transition standard-time instant
 * The diff is always exactly one hour.
 *
 * If `date` is not in an ambiguous window, returns `date` unchanged.
 */
export function resolveAmbiguousHour(
  date: Date,
  tz: TimezoneId,
  prefer: 'earlier' | 'later',
): Date {
  const offsetNow = timezoneOffsetMinutes(date, tz);
  const offset1hEarlier = timezoneOffsetMinutes(
    new Date(date.getTime() - ONE_HOUR_MS),
    tz,
  );
  const offset1hLater = timezoneOffsetMinutes(
    new Date(date.getTime() + ONE_HOUR_MS),
    tz,
  );

  if (offsetNow !== offset1hEarlier) {
    // We are at the SECOND occurrence (after the fall-back).
    const earlier = new Date(date.getTime() - ONE_HOUR_MS);
    return prefer === 'earlier' ? earlier : date;
  }
  if (offsetNow !== offset1hLater) {
    // We are at the FIRST occurrence (just before the fall-back).
    const later = new Date(date.getTime() + ONE_HOUR_MS);
    return prefer === 'earlier' ? date : later;
  }
  // Not in an ambiguous window.
  return date;
}
