/**
 * ISO-4217-aware currency formatting helpers shared by every BORJIE
 * frontend (owner-portal, customer-app, manager-app, …).
 *
 * Background:
 *   Per-app formatters used to hardcode `currency = 'USD'` and
 *   `minimumFractionDigits = maximumFractionDigits = 0`. That silently
 *   mis-formatted:
 *     - BHD/JOD/KWD/OMR/TND/IQD/LYD (3-decimal) — truncated to whole units
 *     - CLF (4-decimal)               — truncated to whole units
 *     - JPY/KRW/VND/UGX/RWF/…/XAF/XOF (0-decimal) — coincidentally OK
 *     - every 2-decimal currency      — truncated to whole units
 *
 *   `packages/central-intelligence/src/kernel/tools/render-blocks/currency-codes.ts`
 *   already mirrors the canonical 140+-entry ISO-4217 table for the
 *   brain↔UI wire protocol. This helper mirrors the same precision
 *   table on the renderer side so amounts come out with the correct
 *   fractional precision for every supported code.
 *
 * Source of truth:
 *   `packages/domain-models/src/common/currencies.ts` (`ISO_4217_DECIMALS`).
 *   This file re-exports the precision lookup through a single named
 *   helper so apps never reach into domain-models internals.
 *
 * Design choices:
 *   - `currency` is REQUIRED on `formatCurrency`. If absent we throw
 *     rather than silently mis-format with a hardcoded default. Callers
 *     must thread the user/tenant/platform currency through.
 *   - `getCurrencyDecimals` returns the ISO-4217 precision and defaults
 *     to 2 for unknown codes (matches `decimalsForCurrency` in
 *     domain-models). A one-shot console warning in dev catches typos.
 *   - The formatter uses `Intl.NumberFormat` with `style: 'currency'`
 *     and explicit `minimumFractionDigits = maximumFractionDigits =
 *     <ISO decimals>` so BHD prints `BHD 100.000` (3 decimals) and JPY
 *     prints `JPY 100,000` (0 decimals) regardless of runtime defaults.
 *   - `currencyDisplay: 'code'` is used so the symbol is the ISO code
 *     (`KES`, `USD`, `BHD`) instead of locale-specific glyphs. This
 *     matches every existing per-app formatter and is what the audit
 *     `.audit/production-readiness-gaps.md` calls for.
 */

import { CURRENCY_DECIMALS } from '@borjie/domain-models';

/**
 * Return the ISO-4217 fractional-decimal count for `code`.
 *
 * Most currencies have 2 decimals, but:
 *   - JPY, KRW, VND, UGX, RWF, TZS, XAF, XOF, XPF, BIF, CLP, DJF,
 *     GNF, ISK, KMF, PYG, VUV: 0 decimals
 *   - BHD, JOD, KWD, OMR, TND, IQD, LYD: 3 decimals
 *   - CLF: 4 decimals
 *
 * Unknown codes default to 2 — matches the domain-models behaviour for
 * arithmetic safety. Pass a known ISO-4217 code to avoid the fallback.
 *
 * @param code ISO-4217 currency code (3 upper-case letters).
 * @returns Fractional-decimal count (0 | 2 | 3 | 4 in practice).
 */
export function getCurrencyDecimals(code: string): number {
  const decimals = CURRENCY_DECIMALS[code];
  return typeof decimals === 'number' ? decimals : 2;
}

/**
 * Options for {@link formatCurrency}. Locale defaults to the runtime
 * default; pass an explicit locale (`'en-KE'`, `'sw-TZ'`, `'ja-JP'`, …)
 * to control thousands separators and digit-group sizing.
 */
export interface FormatCurrencyOptions {
  /** BCP-47 locale tag. Defaults to runtime (`undefined`) → user agent. */
  readonly locale?: string;
  /**
   * `'code'` (default) prints the ISO code as the prefix (`KES 1,000.00`).
   * `'symbol'` prints the locale-specific symbol (`KSh 1,000.00`).
   * `'narrowSymbol'` prints the shortest locale symbol.
   * `'name'` prints the full localised name (`1,000.00 Kenyan shillings`).
   */
  readonly currencyDisplay?: 'code' | 'symbol' | 'narrowSymbol' | 'name';
}

/**
 * Format a numeric major-unit amount in the given ISO-4217 currency.
 *
 * Always uses the ISO fractional precision from
 * `getCurrencyDecimals(currency)` so 0/2/3/4-decimal currencies all
 * render correctly.
 *
 * @param amount   Major-unit amount (e.g. 100 for KES 100.00).
 *                 Pass `Number(invoice.amount)` if your data is a string.
 * @param currency ISO-4217 currency code. **Required at runtime** —
 *                 if absent / empty / whitespace-only / null /
 *                 undefined, this **throws**. The type is widened to
 *                 `string | null | undefined` so existing call sites
 *                 still typecheck (the old helper had a `'USD'`
 *                 default — see audit
 *                 `.audit/production-readiness-gaps.md`), but the
 *                 helper now refuses to silently mis-format. Callers
 *                 must thread the active tenant/user currency.
 * @param options  Optional locale + display style.
 * @returns        Locale-formatted string (e.g. `'KES 1,500.00'`,
 *                 `'JPY 100,000'`, `'BHD 100.000'`).
 *
 * @throws Error if `currency` is not a non-empty string.
 */
export function formatCurrency(
  amount: number,
  currency: string | null | undefined,
  options: FormatCurrencyOptions = {},
): string {
  if (typeof currency !== 'string' || currency.trim().length === 0) {
    throw new Error(
      'formatCurrency: `currency` arg is required (ISO-4217 code). ' +
        'Refusing to silently default — pass the tenant/user currency.',
    );
  }

  const code = currency.trim().toUpperCase();
  const decimals = getCurrencyDecimals(code);
  const { locale, currencyDisplay = 'code' } = options;

  // Non-finite amounts (NaN, Infinity) would crash Intl.NumberFormat;
  // return a safe placeholder so consumer screens don't blow up.
  if (!Number.isFinite(amount)) {
    return `${code} —`;
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    // Some legacy runtimes reject obscure ISO codes. Fall back to a
    // manual format that still respects the ISO decimal count.
    const fixed = amount.toFixed(decimals);
    const parts = fixed.split('.');
    const intPart = parts[0] ?? '0';
    const fracPart = parts[1];
    const withGroups = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fracPart ? `${code} ${withGroups}.${fracPart}` : `${code} ${withGroups}`;
  }
}
