/**
 * Number + date formatters for the owner cockpit.
 *
 * Centralised so every screen produces consistent money + date strings
 * from ONE place. Avoids the trap of every component calling
 * `toLocaleString()` with different (and locale-hardcoded) options.
 *
 * CANON (CLAUDE.md "Multi-currency, TZS at launch · expandable"):
 *   - Money renders through `formatCurrency(amount, currencyCode, …)` —
 *     the ISO-4217 code is DATA, never a hardcoded `'TZS '`/`'$'` prefix.
 *   - The Intl locale follows the user's active locale, never a
 *     hardcoded BCP-47 literal (`'en-TZ'`, `'en-GB'`). `bcp47For(locale)`
 *     is the single resolver.
 *   - TZS stays the launch-primary DEFAULT for surfaces whose data is
 *     TZS-denominated by schema (columns named `*Tzs`), but it is passed
 *     as an argument — so a KE/UG/NG tenant threading its own code
 *     renders its own currency with zero code change.
 */

import { formatCurrency } from '@borjie/api-client';
import { readLocaleFromDocument, type Locale } from './locale-shared';

/**
 * Tanzania is the launch jurisdiction; surfaces whose underlying data is
 * TZS-denominated by schema default to this code when the caller has no
 * tenant-currency to thread. KE/UG/NG tenants pass their own ISO code.
 */
export const LAUNCH_CURRENCY = 'TZS';

/**
 * Placeholder rendered for a non-finite numeric input (NaN / Infinity /
 * null / undefined). A formatter must never paint `TZS NaNM` or `NaN%` to
 * an owner — a missing/bad number degrades to an em-dash, the same
 * convention `formatCurrency` uses for non-finite amounts.
 */
const NON_FINITE_PLACEHOLDER = '—';

/**
 * Resolve the Intl BCP-47 tag from the active locale — the
 * locale-follows-the-user canon. NEVER hardcode `'en-TZ'`/`'en-GB'` in a
 * component; resolve here from the user's chosen language.
 */
export function bcp47For(locale: Locale): string {
  return locale === 'sw' ? 'sw-TZ' : 'en-GB';
}

const NUM0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const NUM2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/**
 * Locale- and currency-aware money formatter — the canonical money
 * render for the cockpit. `currencyCode` is REQUIRED data (ISO-4217);
 * `locale` drives the digit grouping. Whole-unit precision is overridden
 * by the ISO decimal count inside `formatCurrency`.
 */
export function formatMoney(
  amount: number,
  currencyCode: string,
  locale: Locale,
): string {
  return formatCurrency(amount, currencyCode, { locale: bcp47For(locale) });
}

/**
 * Compact money for large aggregates — e.g. "TZS 1.2B" / "KES 450M".
 * The code prefix comes from the supplied `currencyCode` (data), never a
 * hardcoded literal; sub-million values fall through to `formatMoney`.
 */
export function formatLargeMoney(
  amount: number,
  currencyCode: string,
  locale: Locale,
): string {
  const code = currencyCode.trim().toUpperCase();
  if (!Number.isFinite(amount)) return `${code} ${NON_FINITE_PLACEHOLDER}`;
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000_000) {
    return `${code} ${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  }
  if (abs >= 1_000_000) {
    return `${code} ${sign}${(abs / 1_000_000).toFixed(1)}M`;
  }
  return formatMoney(amount, code, locale);
}

/**
 * Compact money already expressed in MILLIONS of the unit — e.g. a
 * pre-divided P&L figure renders as "TZS 1.20M". `currencyCode` is data.
 */
export function formatMoneyMillions(
  valueInMillions: number,
  currencyCode: string,
): string {
  const code = currencyCode.trim().toUpperCase();
  if (!Number.isFinite(valueInMillions)) return `${code} ${NON_FINITE_PLACEHOLDER}`;
  return `${code} ${NUM2.format(valueInMillions)}M`;
}

export function fmtNum(value: number): string {
  if (!Number.isFinite(value)) return NON_FINITE_PLACEHOLDER;
  return NUM0.format(value);
}

export function fmtPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return NON_FINITE_PLACEHOLDER;
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Format a date strictly for the active locale — never a hardcoded
 * 'en-GB'/'en-US'. The BCP-47 tag follows the user's locale (the
 * locale-follows-the-user canon): `sw` renders `sw-TZ`, `en` renders
 * `en-GB`. Numeric-leaning style so month rendering stays locale-correct.
 * Single shared implementation reused by the living-plan, royalty-sign,
 * and compliance-pack surfaces.
 */
export function fmtDateForLocale(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(bcp47For(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * Locale-aware month + year (no day) — for period ranges. Follows the
 * active locale's BCP-47 tag like `fmtDateForLocale`.
 */
export function fmtMonthYearForLocale(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(bcp47For(locale), {
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * Locale-aware time (hour + minute). Follows the active locale's BCP-47
 * tag — never a hardcoded 'en-GB'.
 */
export function fmtTimeForLocale(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(bcp47For(locale), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Date formatter for call sites that do NOT yet thread the active locale
 * (client-side timeline / audit / report rows). It resolves the active
 * locale from the cookie itself — `bcp47For(readLocaleFromDocument())` —
 * so it is locale-correct without a hardcoded `'en-GB'` and without
 * touching every caller. Prefer `fmtDateForLocale` where a locale is
 * already in scope.
 */
export function fmtDate(iso: string): string {
  return fmtDateForLocale(iso, readLocaleFromDocument());
}

/**
 * Time formatter for locale-unaware call sites — resolves the active
 * locale from the cookie like `fmtDate`. Prefer `fmtTimeForLocale` where
 * a locale is in scope.
 */
export function fmtTime(iso: string): string {
  return fmtTimeForLocale(iso, readLocaleFromDocument());
}
