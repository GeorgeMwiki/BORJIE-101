/**
 * Locale-aware formatters for KPI tiles + table cells.
 *
 * Currency is typed as ISO-4217 string — the supported locale table
 * below is a hint registry, not the authoritative list. Unknown codes
 * fall back to the generic Intl.NumberFormat path (still renders
 * cleanly via `${currency} ${value}`).
 *
 * The user's preferred display currency lives in a separate
 * `currency_preferences` table (see MEMORY.md guidance); the brain
 * SHOULD pass values in the user's preferred currency already, and
 * the formatter only handles the locale rendering.
 */

export type Currency = string;

const LOCALES: Readonly<Record<string, string>> = Object.freeze({
  KES: 'en-KE',
  TZS: 'sw-TZ',
  USD: 'en-US',
});

/**
 * Placeholder for a non-finite numeric input (NaN / Infinity / null /
 * undefined coerced to NaN). `Intl.NumberFormat().format(NaN)` does NOT
 * throw — it returns `"$NaN"` / `"NaN"` — so the `catch` below never
 * fires for bad numbers; a KPI tile would render `$NaN` to the user.
 * Guard explicitly and degrade to an em-dash instead.
 */
const NON_FINITE_PLACEHOLDER = '—';

export function formatCurrency(value: number, currency: Currency): string {
  if (!Number.isFinite(value)) return `${currency} ${NON_FINITE_PLACEHOLDER}`;
  try {
    return new Intl.NumberFormat(LOCALES[currency], {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}

export function formatPercent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return NON_FINITE_PLACEHOLDER;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'percent',
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    return `${(value * 100).toFixed(fractionDigits)}%`;
  }
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return NON_FINITE_PLACEHOLDER;
  try {
    return new Intl.NumberFormat('en-US').format(value);
  } catch {
    return String(value);
  }
}

export function formatDate(value: string | number | Date): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

export function formatCell(
  value: unknown,
  fmt: 'text' | 'currency' | 'percent' | 'number' | 'date' | undefined,
  currency?: Currency,
): string {
  if (value === null || value === undefined) return '';
  if (fmt === 'currency' && typeof value === 'number' && currency) {
    return formatCurrency(value, currency);
  }
  if (fmt === 'percent' && typeof value === 'number') return formatPercent(value);
  if (fmt === 'number' && typeof value === 'number') return formatNumber(value);
  if (fmt === 'date') return formatDate(value as string);
  return String(value);
}
