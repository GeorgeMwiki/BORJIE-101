/**
 * Next-occurrence resolution for a *minimal* cron expression in a
 * specific timezone.
 *
 * Supported cron field forms:
 *   - `*`             — any value
 *   - integer literal — `0`, `9`, `30`
 *   - comma list      — `0,15,30,45`
 *   - step            — `* / 5` (every 5 in range)   [spaces are OK]
 *
 * Range, name, `?`, year-field and seconds-field are NOT supported —
 * use a real cron library at composition time if you need them.
 *
 * Fields (5 tokens): minute hour day-of-month month day-of-week
 *   minute       0..59
 *   hour         0..23
 *   day-of-month 1..31
 *   month        1..12
 *   day-of-week  0..6  (0 = Sun, 6 = Sat)
 *
 * The match is computed in `tz` wall-clock terms, then converted to a
 * UTC instant via `wallClockToInstant`.
 */

import type { TimezoneId } from '../types.js';
import { partsInZone } from '../dst-handling/offset.js';
import { wallClockToInstant } from '../dst-handling/safe-arithmetic.js';

const MAX_ITER_DAYS = 366 * 2;

interface ParsedField {
  readonly any: boolean;
  readonly values: ReadonlySet<number>;
}

function parseField(token: string, min: number, max: number): ParsedField {
  const t = token.replace(/\s+/g, '');
  if (t === '*') return { any: true, values: new Set() };

  if (t.startsWith('*/')) {
    const step = parseInt(t.slice(2), 10);
    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`cron: invalid step "${token}"`);
    }
    const values = new Set<number>();
    for (let v = min; v <= max; v += step) values.add(v);
    return { any: false, values };
  }

  const values = new Set<number>();
  for (const piece of t.split(',')) {
    const n = parseInt(piece, 10);
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new Error(`cron: invalid value "${piece}" (range ${min}..${max})`);
    }
    values.add(n);
  }
  return { any: false, values };
}

function matches(field: ParsedField, value: number): boolean {
  return field.any || field.values.has(value);
}

/**
 * Returns the next UTC Date when the cron expression fires in `tz`,
 * strictly after `from` (default = now). Throws if no match in 2 years.
 */
export function nextOccurrence(
  cronExpr: string,
  tz: TimezoneId,
  from: Date = new Date(),
): Date {
  const tokens = cronExpr.trim().split(/\s+/);
  if (tokens.length !== 5) {
    throw new Error(
      `cron: expected 5 fields (minute hour dom month dow), got ${tokens.length}`,
    );
  }
  const [minTok, hourTok, domTok, monthTok, dowTok] = tokens as [string, string, string, string, string];
  const minute = parseField(minTok, 0, 59);
  const hour = parseField(hourTok, 0, 23);
  const dom = parseField(domTok, 1, 31);
  const month = parseField(monthTok, 1, 12);
  const dow = parseField(dowTok, 0, 6);

  const start = partsInZone(from, tz);
  // Walk forward minute-by-minute is too slow. Walk day-by-day, then
  // hour-by-hour, then minute-by-minute within the matching day-hour.
  for (let dayDelta = 0; dayDelta < MAX_ITER_DAYS; dayDelta++) {
    const cursor = new Date(
      Date.UTC(start.year, start.month - 1, start.day) +
        dayDelta * 24 * 60 * 60 * 1000,
    );
    const dp = {
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
      day: cursor.getUTCDate(),
      dow: cursor.getUTCDay(),
    };
    if (!matches(month, dp.month)) continue;
    if (!matches(dom, dp.day)) continue;
    if (!matches(dow, dp.dow)) continue;

    for (let h = 0; h < 24; h++) {
      if (!matches(hour, h)) continue;
      for (let m = 0; m < 60; m++) {
        if (!matches(minute, m)) continue;
        const candidate = wallClockToInstant(dp.year, dp.month, dp.day, h, m, 0, tz);
        if (candidate.getTime() > from.getTime()) return candidate;
      }
    }
  }
  throw new Error(`cron: no occurrence within ${MAX_ITER_DAYS} days`);
}
