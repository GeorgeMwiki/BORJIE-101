/**
 * Relative time rendering ("2 hours ago", "in 5 minutes") that is
 * STILL anchored to the user's timezone for day/week boundaries.
 *
 * Uses `Intl.RelativeTimeFormat` (Node 20+). For sub-day deltas the
 * answer is the same in every TZ. For day/month/year deltas we compute
 * the calendar diff in the user's TZ — e.g. "yesterday" depends on
 * which timezone you mean.
 */

import type { TimezoneId } from '../types.js';
import { partsInZone } from '../dst-handling/offset.js';

const FORMATTER_CACHE = new Map<string, Intl.RelativeTimeFormat>();

function getRelativeFormatter(locale: string): Intl.RelativeTimeFormat {
  let f = FORMATTER_CACHE.get(locale);
  if (!f) {
    f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    FORMATTER_CACHE.set(locale, f);
  }
  return f;
}

interface RelativeTimeOpts {
  readonly tz: TimezoneId;
  readonly locale?: string;
  readonly now?: () => Date;
}

/**
 * Returns a human-readable string like "2 hours ago", "in 5 minutes",
 * "yesterday" — locale-aware. Day/week/month/year boundaries are
 * computed in `opts.tz`.
 */
export function relativeTime(date: Date, opts: RelativeTimeOpts): string {
  const locale = opts.locale ?? 'en-US';
  const now = (opts.now ?? (() => new Date()))();
  const deltaMs = date.getTime() - now.getTime();
  const absSec = Math.abs(deltaMs) / 1000;
  const fmt = getRelativeFormatter(locale);

  // Sub-minute → seconds
  if (absSec < 60) return fmt.format(Math.round(deltaMs / 1000), 'second');

  // Sub-hour → minutes
  if (absSec < 3600) return fmt.format(Math.round(deltaMs / 60_000), 'minute');

  // Sub-day-in-tz → hours
  const sameTZDay = sameDayInTZ(date, now, opts.tz);
  if (sameTZDay && absSec < 24 * 3600) {
    return fmt.format(Math.round(deltaMs / 3_600_000), 'hour');
  }

  // Compute day delta in the user's TZ (so "yesterday" really means
  // calendar yesterday wherever the user is).
  const dayDelta = calendarDayDiffInTZ(date, now, opts.tz);

  if (Math.abs(dayDelta) < 30) return fmt.format(dayDelta, 'day');
  if (Math.abs(dayDelta) < 365) return fmt.format(Math.round(dayDelta / 30), 'month');
  return fmt.format(Math.round(dayDelta / 365), 'year');
}

function sameDayInTZ(a: Date, b: Date, tz: TimezoneId): boolean {
  const pa = partsInZone(a, tz);
  const pb = partsInZone(b, tz);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

function calendarDayDiffInTZ(a: Date, b: Date, tz: TimezoneId): number {
  const pa = partsInZone(a, tz);
  const pb = partsInZone(b, tz);
  // Compare calendar-day ordinals as if both were UTC midnight.
  const dayA = Date.UTC(pa.year, pa.month - 1, pa.day);
  const dayB = Date.UTC(pb.year, pb.month - 1, pb.day);
  return Math.round((dayA - dayB) / (24 * 60 * 60 * 1000));
}
