/**
 * DST-transition detection.
 *
 *   - spring-forward: 02:00 wall-clock is skipped → e.g. America/New_York
 *     jumps 01:59 → 03:00 on the 2nd Sunday of March. The gap is 60min.
 *   - fall-back:     01:00..02:00 wall-clock occurs TWICE → e.g.
 *     America/New_York repeats 01:00..02:00 on the 1st Sunday of November.
 *     The overlap is 60min.
 *
 * Strategy: compute the UTC offset at `date` and at `date - 24h`. If
 * they differ, a transition occurred in the last 24h window.
 *   - positive diff (offset became LESS negative, e.g. -300 → -240) →
 *     spring-forward
 *   - negative diff (offset became MORE negative, e.g. -240 → -300) →
 *     fall-back
 */

import type { DSTRule, TimezoneId } from '../types.js';
import { timezoneOffsetMinutes } from './offset.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the DST-rule outcome for the 24h window ending at `date` in
 * `tz`. `null` when no transition crossed that window.
 */
export function isDSTTransition(date: Date, tz: TimezoneId): DSTRule {
  const offsetNow = timezoneOffsetMinutes(date, tz);
  const offset24hAgo = timezoneOffsetMinutes(new Date(date.getTime() - ONE_DAY_MS), tz);
  const diff = offsetNow - offset24hAgo;
  if (diff === 0) return null;
  if (diff > 0) {
    return { kind: 'spring-forward', gapMinutes: diff, observed: tz };
  }
  return { kind: 'fall-back', overlapMinutes: -diff, observed: tz };
}

/**
 * Returns true iff `date` falls strictly inside the ambiguous fall-back
 * wall-clock hour (the hour that renders twice in the local zone).
 *
 * Both UTC instants that produce the same wall-clock string are
 * "ambiguous" — we detect either by checking whether the wall-clock
 * representation 1h later equals the wall-clock representation now (the
 * tell-tale sign of a fall-back overlap).
 */
export function isInAmbiguousHour(date: Date, tz: TimezoneId): boolean {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const offsetNow = timezoneOffsetMinutes(date, tz);
  const offset1hLater = timezoneOffsetMinutes(
    new Date(date.getTime() + ONE_HOUR_MS),
    tz,
  );
  const offset1hEarlier = timezoneOffsetMinutes(
    new Date(date.getTime() - ONE_HOUR_MS),
    tz,
  );
  // First occurrence: offset shrinks (becomes less positive / more
  // negative) within the next hour → fall-back is upcoming.
  // Second occurrence: offset already shrank within the past hour →
  // we are sitting in the duplicated wall-clock window.
  return offsetNow !== offset1hLater || offsetNow !== offset1hEarlier;
}
