/**
 * Locale-aware number + date formatters for the admin console.
 *
 * Centralised so every screen produces number/date strings from ONE
 * place — and, critically, so the Intl locale ALWAYS follows the
 * operator's active locale instead of the host default. A bare
 * `n.toLocaleString()` / `new Date(x).toLocaleString()` inside a
 * localized surface silently formats with whatever locale the browser
 * (or Node SSR) happens to run under — a zero-mix canon violation:
 * digit-grouping / date order can disagree with the rendered language.
 *
 * CANON (CLAUDE.md "locale follows the user, not the code"):
 *   - The Intl locale is resolved from the active `Locale` via
 *     `bcp47For(locale)` — the single resolver. NEVER hardcode a BCP-47
 *     literal (`'en-GB'`, `'sw-TZ'`) in a component or a host-default
 *     formatter call with no locale argument.
 *
 * Mirrors apps/owner-web/src/lib/format.ts `bcp47For(locale)`.
 */

import type { Locale } from './locale-shared';

/**
 * Resolve the Intl BCP-47 tag from the active locale — the
 * locale-follows-the-user canon. `sw` → Swahili (Tanzania); everything
 * else → English (GB grouping, the launch convention). Resolve HERE, never
 * inline a literal in a component.
 */
export function bcp47For(locale: Locale): string {
  return locale === 'sw' ? 'sw-TZ' : 'en-GB';
}

/**
 * Locale-aware integer/number formatter. Threads the active locale
 * through `Intl.NumberFormat` so grouping matches the rendered language.
 * Non-finite input degrades to an em-dash rather than painting `NaN`.
 */
export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(bcp47For(locale), options).format(value);
}

/**
 * Locale-aware date+time formatter. Threads the active locale so the
 * date order / month names match the rendered language. Invalid dates
 * degrade to an em-dash.
 */
export function formatDateTime(
  value: string | number | Date,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(bcp47For(locale), options).format(d);
}

/**
 * Locale-aware date-only formatter (no time component).
 */
export function formatDate(
  value: string | number | Date,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  return formatDateTime(value, locale, options ?? {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
