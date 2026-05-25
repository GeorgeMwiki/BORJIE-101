/**
 * Render a date in a specific timezone.
 *
 * Built on `Intl.DateTimeFormat` -- every Node 20+ host already ships
 * the full IANA tzdata, so no `date-fns-tz` / `luxon` dependency.
 *
 * Format spec is a subset of common tokens (compatible with how most
 * apps already call moment/luxon):
 *   yyyy -> 4-digit year                         e.g. 2026
 *   MM   -> 2-digit month                        e.g. 05
 *   dd   -> 2-digit day-of-month                 e.g. 25
 *   HH   -> 2-digit hour (24h, h23 cycle)        e.g. 09
 *   hh   -> 2-digit hour (12h)                   e.g. 09
 *   mm   -> 2-digit minute                       e.g. 30
 *   ss   -> 2-digit second                       e.g. 45
 *   ZZZZ -> IANA zone id literal                 e.g. Africa/Nairobi
 *   ZZ   -> numeric offset                       e.g. +03:00
 *   a    -> AM/PM                                e.g. AM
 *
 * For more elaborate locale rendering, prefer `humanReadable()`.
 */

import type { TimezoneId } from '../types.js';
import { partsInZone, timezoneOffsetMinutes } from '../dst-handling/offset.js';
import { isValidTimezone } from '../detect/validate.js';

const FMT_FORMATTERS_12H = new Map<TimezoneId, Intl.DateTimeFormat>();
const FMT_FORMATTERS_24H = new Map<TimezoneId, Intl.DateTimeFormat>();

function get12hFormatter(tz: TimezoneId): Intl.DateTimeFormat {
  let f = FMT_FORMATTERS_12H.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    FMT_FORMATTERS_12H.set(tz, f);
  }
  return f;
}

function get24hFormatter(tz: TimezoneId): Intl.DateTimeFormat {
  let f = FMT_FORMATTERS_24H.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    });
    FMT_FORMATTERS_24H.set(tz, f);
  }
  return f;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${pad2(h)}:${pad2(m)}`;
}

/**
 * Render `date` according to `formatStr`, anchored to `tz`. Returns the
 * formatted string. Throws on unknown tz.
 */
export function renderInTZ(
  date: Date,
  tz: TimezoneId,
  formatStr: string,
): string {
  if (!isValidTimezone(tz)) {
    throw new Error(`renderInTZ: invalid timezone ${tz}`);
  }
  const p = partsInZone(date, tz);
  const offset = timezoneOffsetMinutes(date, tz);

  // 12h hour requires a second lookup because partsInZone is h23-locked.
  const hour12parts = get12hFormatter(tz).formatToParts(date);
  const ampmPart = hour12parts.find((x) => x.type === 'dayPeriod');
  const hour12Part = hour12parts.find((x) => x.type === 'hour');
  const ampm = ampmPart ? ampmPart.value.toUpperCase() : p.hour < 12 ? 'AM' : 'PM';
  const hh12 = hour12Part ? pad2(Number(hour12Part.value)) : pad2(((p.hour + 11) % 12) + 1);

  // Single-pass tokeniser -- never re-substitutes into already-injected
  // text (so an IANA literal that CONTAINS the letter `a`, e.g.
  // "Africa/Kigali", is safe from the AM/PM `a` token). Order matters
  // for tokens that share a prefix: ZZZZ before ZZ, HH before hh handled
  // by JS regex alternation semantics (first match wins).
  const tokens: Array<[string, string]> = [
    ['ZZZZ', tz],
    ['yyyy', String(p.year)],
    ['MM', pad2(p.month)],
    ['dd', pad2(p.day)],
    ['HH', pad2(p.hour)],
    ['hh', hh12],
    ['mm', pad2(p.minute)],
    ['ss', pad2(p.second)],
    ['ZZ', formatOffset(offset)],
    ['a', ampm],
  ];
  const pattern = new RegExp(
    tokens.map(([k]) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g',
  );
  const lookup = new Map(tokens);
  return formatStr.replace(pattern, (m) => lookup.get(m) ?? m);
}

// Re-export the 24h formatter cache for tests + observability.
export const _internal = {
  FMT_FORMATTERS_12H,
  FMT_FORMATTERS_24H,
  get12hFormatter,
  get24hFormatter,
  formatOffset,
};
