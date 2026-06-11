/**
 * @borjie/document-studio — render-time value formatters.
 *
 * Typst/Carbone templates cannot call JS, so every monetary figure is
 * pre-formatted HERE in the builder and injected as a ready-to-print
 * string. This is the document-studio implementation of the project-wide
 * `formatCurrency(amount, currencyCode)` convention (canonical source:
 * `packages/api-client/src/currency.ts`) — kept local so this package
 * stays dependency-light (zod only) instead of importing a UI/client
 * package server-side.
 *
 * HARD RAIL (CLAUDE.md): never hard-code a currency. `formatCurrency`
 * REQUIRES an ISO-4217 code and refuses to silently default — the caller
 * must pass the tenant/owner currency.
 */

export interface FormatCurrencyOptions {
  /** BCP-47 locale for digit grouping (e.g. 'en', 'sw-TZ'). */
  readonly locale?: string;
  /** Intl currencyDisplay; 'code' renders like `TZS 1,234,567`. */
  readonly currencyDisplay?: 'code' | 'symbol' | 'narrowSymbol' | 'name';
}

/**
 * Format `amount` in `currency` (ISO-4217) per the project convention.
 *
 * @throws Error when `currency` is missing/blank — never silently defaults.
 */
export function formatCurrency(
  amount: number,
  currency: string | null | undefined,
  options: FormatCurrencyOptions = {},
): string {
  if (typeof currency !== 'string' || currency.trim().length === 0) {
    throw new Error(
      'formatCurrency: `currency` arg is required (ISO-4217 code). ' +
        'Refusing to silently default — pass the tenant/owner currency.',
    );
  }
  const code = currency.trim().toUpperCase();
  const { locale, currencyDisplay = 'code' } = options;

  // Non-finite amounts (NaN/Infinity) would crash Intl — safe placeholder.
  if (!Number.isFinite(amount)) {
    return `${code} —`;
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay,
    }).format(amount);
  } catch {
    // Unknown code → generic, still never hard-coded.
    return `${code} ${formatNumber(amount, locale === undefined ? {} : { locale })}`;
  }
}

export interface FormatNumberOptions {
  readonly locale?: string;
  readonly maximumFractionDigits?: number;
}

/** Group-format a plain (non-monetary) number — tonnages, areas, counts. */
export function formatNumber(
  value: number,
  options: FormatNumberOptions = {},
): string {
  if (!Number.isFinite(value)) return '—';
  const { locale, maximumFractionDigits } = options;
  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: maximumFractionDigits ?? 3,
    }).format(value);
  } catch {
    return String(value);
  }
}

/** Round a monetary number to its currency minor units (default 2). */
export function roundMoney(value: number, fractionDigits = 2): number {
  const f = 10 ** fractionDigits;
  return Math.round((value + Number.EPSILON) * f) / f;
}
