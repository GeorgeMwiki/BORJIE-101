/**
 * ISO-4217 currency-code mirror for the brain↔UI wire protocol.
 *
 * Background:
 *   The AG-UI render-block contract used to hardcode a 3-currency enum
 *   (`'KES' | 'TZS' | 'USD'`) on every `currency` field, which silently
 *   dropped formatting for the other 140+ ISO-4217 codes that ship on
 *   real tenants (JPY, KRW, BHD, BRL, INR, AED, ZAR, NGN, …). The audit
 *   `.audit/production-readiness-gaps.md` (and re-confirmed in
 *   `.audit/deep-audit-2026-05-20.md`) flagged this as the cause of
 *   formatting failures for any non-EAC, non-US tenant.
 *
 * Source of truth:
 *   `packages/domain-models/src/common/currencies.ts` (`ISO_4217_DECIMALS`,
 *   `SUPPORTED_CURRENCY_CODES`). We *mirror* the list here rather than
 *   importing it because `@borjie/central-intelligence` deliberately
 *   keeps a zero-runtime-dep posture on domain-models (mirror pattern is
 *   identical to `regulatory-mirror.ts`). If domain-models ever extends
 *   the table with a new code, regenerate this list — see the audit
 *   workflow in `.github/workflows/audit-coverage.yml` for the diff
 *   guard.
 *
 * Anti-patterns this file prevents:
 *   - LLM emitting a currency string that the UI can't format
 *   - render-block tools accepting `'kes'` (lower-case) or `'kES'`
 *   - silent fall-through to `'XXX'` (ISO unknown-currency) downstream
 */

import { z } from 'zod';

/**
 * Full ISO-4217 current-codes list (140+ codes as of 2025). Kept in
 * alphabetical order so a `git diff` against
 * `packages/domain-models/src/common/currencies.ts` is one-eyeball
 * auditable. Adding a new code is a single-line append.
 *
 * `as const` + tuple cast lets Zod's `z.enum` accept it without losing
 * the literal narrowing that downstream `safeParse` consumers rely on.
 */
export const SUPPORTED_CURRENCY_CODES = [
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL',
  'BSD', 'BTN', 'BWP', 'BYN', 'BZD',
  'CAD', 'CDF', 'CHF', 'CLF', 'CLP', 'CNY', 'COP', 'CRC', 'CUP', 'CVE',
  'CZK',
  'DJF', 'DKK', 'DOP', 'DZD',
  'EGP', 'ERN', 'ETB', 'EUR',
  'FJD', 'FKP',
  'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD',
  'HKD', 'HNL', 'HTG', 'HUF',
  'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK',
  'JMD', 'JOD', 'JPY',
  'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT',
  'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD',
  'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR',
  'MWK', 'MXN', 'MYR', 'MZN',
  'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD',
  'OMR',
  'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG',
  'QAR',
  'RON', 'RSD', 'RUB', 'RWF',
  'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SOS', 'SRD',
  'SSP', 'STN', 'SYP', 'SZL',
  'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS',
  'UAH', 'UGX', 'USD', 'UYU', 'UZS',
  'VES', 'VND', 'VUV',
  'WST',
  'XAF', 'XCD', 'XOF', 'XPF',
  'YER',
  'ZAR', 'ZMW', 'ZWG',
] as const;

/**
 * Compile-time narrowed literal-union of every supported code.
 *
 * Kept structurally identical to the `CurrencyCode` type that
 * `@borjie/domain-models` exports (its is a broad `string` for
 * compatibility, ours is a tight literal-union here so the renderer
 * gets editor-side narrowing). Both shapes assignment-flow into
 * `string` so external callers passing arbitrary ISO-4217 codes still
 * compile.
 */
export type CurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

// `z.enum` needs a NON-readonly mutable tuple `[T, ...T[]]` at the
// type level, but we want `SUPPORTED_CURRENCY_CODES` to stay
// `readonly` for runtime immutability. The cast below is the
// canonical Zod-3 idiom: the array itself is still frozen by `as
// const` (preventing mutation), only the *type* is widened so
// `z.infer<typeof CurrencyCodeSchema>` gives back the literal-union
// `'AED' | 'AFN' | …` instead of broad `string`.
type WritableCurrencyCodeTuple = [CurrencyCode, ...CurrencyCode[]];

/**
 * Zod schema for a single ISO-4217 currency code.
 *
 * Uses `z.enum` (not `z.string().regex(...)`) so we get an
 * enumeration on the parsed value, which downstream JSON-schema
 * generators emit as `enum: [...]` for LLM tool-use descriptors. A
 * fast-fail on `'XYZ'` is required so the agent loop can repair-pass
 * instead of letting an unknown code escape into the renderer.
 *
 * `z.infer<typeof CurrencyCodeSchema>` resolves to the literal-union
 * `CurrencyCode`, not `string`, so callers of `safeParse` get the
 * narrowed type without an extra cast.
 */
export const CurrencyCodeSchema = z.enum(
  SUPPORTED_CURRENCY_CODES as unknown as WritableCurrencyCodeTuple,
);

/**
 * JSON-schema fragment for the LLM tool descriptor. Includes both
 * `pattern` (cheap structural check) and `enum` (semantic
 * narrowing) so Anthropic / OpenAI tool-use validators can pick
 * whichever they prefer.
 *
 * Mutating the returned object is forbidden — callers should spread
 * it into their schema if they need to extend.
 */
export const CURRENCY_JSON_SCHEMA: Readonly<{
  readonly type: 'string';
  readonly pattern: string;
  readonly enum: ReadonlyArray<string>;
  readonly description: string;
}> = Object.freeze({
  type: 'string' as const,
  pattern: '^[A-Z]{3}$',
  enum: SUPPORTED_CURRENCY_CODES,
  description:
    'ISO-4217 currency code (3 upper-case letters). Full set mirrored from ' +
    '`packages/domain-models/src/common/currencies.ts`.',
});

/**
 * Last-resort fallback when neither the caller nor the tenant's
 * `currency_preferences` lookup yields a currency code. Chosen as
 * `'USD'` (not `'KES'` or `'TZS'`) because BORJIE ships globally
 * and any region-specific default is hostile to the other 200
 * jurisdictions.
 */
export const LAST_RESORT_CURRENCY: CurrencyCode = 'USD';
