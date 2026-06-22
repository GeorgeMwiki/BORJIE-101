/**
 * Number + date formatters for the owner cockpit.
 *
 * Centralised so every screen produces consistent TZS / USD / date
 * strings. Avoids the trap of every component calling
 * `toLocaleString('en-TZ')` with different options.
 */

// UNIV-4: hardcoded launch-beachhead locale + currency — when expanding beyond TZ, defer to tenant jurisdiction profile + language pack (Intl.NumberFormat builder seeded from profile.currencyCode + profile.locale); tracked gh-issue (universal-from-day-one). See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
const TZS = new Intl.NumberFormat('en-TZ', {
  style: 'currency',
  currency: 'TZS',
  maximumFractionDigits: 0,
});
const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const NUM0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const NUM2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function fmtTzs(value: number): string {
  return TZS.format(value);
}

export function fmtTzsM(valueInMillions: number): string {
  return `TZS ${NUM2.format(valueInMillions)}M`;
}

export function fmtUsd(value: number): string {
  return USD.format(value);
}

export function fmtNum(value: number): string {
  return NUM0.format(value);
}

export function fmtPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function fmtDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * Format a date strictly for the active locale — never a hardcoded
 * 'en-GB'/'en-US'. The BCP-47 tag follows the user's locale (the
 * locale-follows-the-user canon): `sw` renders `sw-TZ`, `en` renders
 * `en-GB`. Numeric-leaning style so month rendering stays locale-correct.
 * Single shared implementation reused by the living-plan, royalty-sign,
 * and compliance-pack surfaces.
 */
export function fmtDateForLocale(iso: string, locale: 'en' | 'sw'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const bcp47 = locale === 'sw' ? 'sw-TZ' : 'en-GB';
  return new Intl.DateTimeFormat(bcp47, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * Locale-aware month + year (no day) — for period ranges. Follows the
 * active locale's BCP-47 tag like `fmtDateForLocale`.
 */
export function fmtMonthYearForLocale(iso: string, locale: 'en' | 'sw'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const bcp47 = locale === 'sw' ? 'sw-TZ' : 'en-GB';
  return new Intl.DateTimeFormat(bcp47, {
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function fmtTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function fmtRelativeSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}
