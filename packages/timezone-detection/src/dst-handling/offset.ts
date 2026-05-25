/**
 * Compute the UTC-offset in minutes for a specific instant in a specific
 * timezone, using `Intl.DateTimeFormat` parts (the only API that handles
 * historical + future DST transitions accurately on every Node 20+ host).
 *
 * Returns a SIGNED minute count, e.g. `Africa/Nairobi` → 180.
 */

import type { TimezoneId, TimezoneOffsetMinutes } from '../types.js';

const FORMATTER_CACHE = new Map<TimezoneId, Intl.DateTimeFormat>();

function getFormatter(tz: TimezoneId): Intl.DateTimeFormat {
  let f = FORMATTER_CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FORMATTER_CACHE.set(tz, f);
  }
  return f;
}

/**
 * Returns the wall-clock components for an instant rendered in a zone.
 * Internal helper — exported for unit tests.
 */
export function partsInZone(
  date: Date,
  tz: TimezoneId,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = getFormatter(tz).formatToParts(date);
  const out: Record<string, number> = {};
  for (const p of parts) {
    if (p.type === 'literal') continue;
    out[p.type] = Number(p.value);
  }
  return {
    year: out['year'] ?? 1970,
    month: out['month'] ?? 1,
    day: out['day'] ?? 1,
    hour: out['hour'] ?? 0,
    minute: out['minute'] ?? 0,
    second: out['second'] ?? 0,
  };
}

/**
 * Compute the signed UTC offset (in minutes) for `date` interpreted in
 * `tz`. `Africa/Nairobi` returns 180. `America/New_York` returns -300
 * in winter, -240 in summer.
 */
export function timezoneOffsetMinutes(
  date: Date,
  tz: TimezoneId,
): TimezoneOffsetMinutes {
  const p = partsInZone(date, tz);
  // Build the UTC timestamp that the wall-clock components represent
  // *as if they were UTC*. The diff against the actual instant is the
  // offset.
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}
