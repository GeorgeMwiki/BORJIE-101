/**
 * Locale-aware "human" rendering — uses Intl.DateTimeFormat directly so
 * the output matches the user's locale conventions (sw-TZ uses 24h
 * format, en-US prefers 12h, etc.).
 */

import type { TimezoneId } from '../types.js';
import { isValidTimezone } from '../detect/validate.js';

export interface HumanReadableOptions {
  readonly tz: TimezoneId;
  readonly locale?: string;
  /** Defaults to `medium` (e.g. "May 25, 2026, 9:30:45 AM"). */
  readonly dateStyle?: 'full' | 'long' | 'medium' | 'short';
  readonly timeStyle?: 'full' | 'long' | 'medium' | 'short';
}

/**
 * Render `date` in the supplied locale + TZ. Returns a localised
 * human-readable string.
 */
export function humanReadable(date: Date, opts: HumanReadableOptions): string {
  if (!isValidTimezone(opts.tz)) {
    throw new Error(`humanReadable: invalid timezone ${opts.tz}`);
  }
  return new Intl.DateTimeFormat(opts.locale ?? 'en-US', {
    timeZone: opts.tz,
    dateStyle: opts.dateStyle ?? 'medium',
    timeStyle: opts.timeStyle ?? 'medium',
  }).format(date);
}
