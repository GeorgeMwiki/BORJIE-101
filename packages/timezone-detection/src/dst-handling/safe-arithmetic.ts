/**
 * DST-aware date arithmetic.
 *
 * `safeAddDays(date, 1, 'America/New_York')` on the spring-forward day
 * stays anchored to the wall-clock hour even though one calendar day
 * is only 23h long.
 *
 * Algorithm:
 *   1. Decompose `date` into wall-clock components (in `tz`).
 *   2. Add the requested day delta to the calendar day.
 *   3. For overflow (e.g. Feb 31), clamp to last-day-of-month.
 *   4. Re-anchor to the original wall-clock hour:minute:second.
 *   5. Disambiguate using the original offset (skip vs duplicate hours).
 *
 * Built on `Intl.DateTimeFormat` — no Luxon / date-fns-tz needed.
 */

import type { TimezoneId } from '../types.js';
import { partsInZone, timezoneOffsetMinutes } from './offset.js';

/**
 * Last day of a calendar month (1-indexed month).
 * Used to clamp e.g. "Jan 31 + 1 month" to Feb 28/29.
 */
function lastDayOfMonth(year: number, month: number): number {
  // Date(year, month, 0) returns last day of previous month — so we
  // pass month+1 then back off 0.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Add `days` to `date`, anchored to the wall-clock in `tz`. Returns a
 * NEW Date — never mutates input.
 */
export function safeAddDays(date: Date, days: number, tz: TimezoneId): Date {
  const original = partsInZone(date, tz);
  const target = new Date(
    Date.UTC(
      original.year,
      original.month - 1,
      original.day,
      original.hour,
      original.minute,
      original.second,
    ),
  );
  target.setUTCDate(target.getUTCDate() + days);

  // Re-extract — the calendar arithmetic may have crossed a month/year.
  const cal = {
    year: target.getUTCFullYear(),
    month: target.getUTCMonth() + 1,
    day: target.getUTCDate(),
  };

  // Re-anchor by converting the wall-clock back into a real instant in tz.
  return wallClockToInstant(
    cal.year,
    cal.month,
    cal.day,
    original.hour,
    original.minute,
    original.second,
    tz,
  );
}

/**
 * Add `months` to `date`, anchored to the wall-clock in `tz`. Clamps
 * overflow (e.g. "Feb 31" → "Feb 28").
 */
export function safeAddMonths(date: Date, months: number, tz: TimezoneId): Date {
  const original = partsInZone(date, tz);
  const targetMonthIdx = original.month - 1 + months;
  const targetYear = original.year + Math.floor(targetMonthIdx / 12);
  const targetMonth = ((targetMonthIdx % 12) + 12) % 12 + 1; // 1..12
  const maxDay = lastDayOfMonth(targetYear, targetMonth);
  const targetDay = Math.min(original.day, maxDay);

  return wallClockToInstant(
    targetYear,
    targetMonth,
    targetDay,
    original.hour,
    original.minute,
    original.second,
    tz,
  );
}

/**
 * Convert wall-clock components in `tz` into a UTC instant. This is the
 * inverse of `Intl.DateTimeFormat` — we iterate to fixed-point because
 * the offset itself depends on the instant (DST).
 */
export function wallClockToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: TimezoneId,
): Date {
  // First guess: treat the wall-clock as UTC.
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Adjust by the offset at the guess instant.
  const offset1 = timezoneOffsetMinutes(guess, tz);
  const corrected1 = new Date(guess.getTime() - offset1 * 60_000);
  // Re-check — DST transitions may shift the offset between guesses.
  const offset2 = timezoneOffsetMinutes(corrected1, tz);
  if (offset2 === offset1) return corrected1;
  return new Date(guess.getTime() - offset2 * 60_000);
}
