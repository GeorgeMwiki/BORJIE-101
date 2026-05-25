/**
 * Shared currency / monetary-amount regex patterns.
 *
 * BORJIE is a global app — every detector that needs to recognise
 * "this is money, do not treat as PII" must use the same authoritative
 * pattern set. This module is the single source of truth.
 *
 * Patterns cover:
 *   - ISO-4217 currency codes for our currently-shipped jurisdictions
 *     plus the most common reserve currencies. New countries are added
 *     here once their plugin lands in `@borjie/compliance-plugins`.
 *   - Per-region informal symbols (Ksh, Tsh, Sh, KShs) that real users
 *     type in chat / WhatsApp / SMS.
 *   - Global currency symbols ($, €, £, ¥, ₦, ₹, R, R$).
 *
 * Consumers:
 *   - `packages/ai-copilot/src/security/pii-scrubber.ts` — MONETARY_PATTERNS
 *   - `packages/central-intelligence/src/kernel/policy-gate.ts` —
 *     ABSOLUTE_MONEY_PATTERN
 *   - `packages/central-intelligence/src/kernel/self-rag/self-rag.ts` —
 *     FINANCIAL_REGEXES
 */

/**
 * ISO-4217 codes for currencies our platform supports today plus common
 * reserve currencies. Order doesn't matter for the alternation. Codes are
 * UPPER-CASE; we always compile the regex with the `i` flag so casing
 * variants (`Tzs`, `tzs`) match.
 */
export const SUPPORTED_CURRENCY_CODES: readonly string[] = Object.freeze([
  // East Africa (currently-shipped)
  'TZS',
  'KES',
  'UGX',
  'RWF',
  // West / Southern Africa
  'NGN',
  'ZAR',
  'GHS',
  'EGP',
  // Reserve currencies
  'USD',
  'EUR',
  'GBP',
  'CHF',
  'JPY',
  'CNY',
  'INR',
  'AUD',
  'CAD',
]);

/**
 * Informal swahili / east-african currency labels that show up in user
 * text (`Ksh`, `Tsh`, `Sh`, `KShs`). These are NOT ISO-4217 codes — they
 * are the way a human types money in chat.
 */
export const INFORMAL_CURRENCY_LABELS: readonly string[] = Object.freeze([
  'Ksh',
  'KShs',
  'KSh',
  'Tsh',
  'TShs',
  'TSh',
  'Sh',
  'Shs',
  'NGN',
  'NaiR',
  'R\\$', // BRL informal — escape $
]);

/** Build the alternation group from a list of code-or-label strings. */
function alternation(items: readonly string[]): string {
  return items.join('|');
}

/**
 * Symbol-style currency tokens. These do NOT have a trailing word
 * boundary in the regex (`$` is not a word character) so we anchor with
 * a lookahead on the digit instead.
 */
export const CURRENCY_SYMBOLS: readonly string[] = Object.freeze([
  '\\$',
  '€',
  '£',
  '¥',
  '₦',
  '₹',
  '₱',
  '₽',
  '₩',
]);

/**
 * One detector that fires on any code/label followed by a number (or a
 * number followed by the label, e.g. `1,500 KES`). The `i` flag makes
 * casing irrelevant.
 */
export const CURRENCY_CODE_RE = new RegExp(
  `\\b(?:${alternation([
    ...SUPPORTED_CURRENCY_CODES,
    ...INFORMAL_CURRENCY_LABELS,
  ])})\\s*[\\d,]+(?:\\.\\d+)?|[\\d,]+(?:\\.\\d+)?\\s*(?:${alternation([
    ...SUPPORTED_CURRENCY_CODES,
    ...INFORMAL_CURRENCY_LABELS,
  ])})\\b`,
  'i',
);

/** Symbol-style detector (e.g. `$1,500`, `€450`). */
export const CURRENCY_SYMBOL_RE = new RegExp(
  `(?:${alternation([...CURRENCY_SYMBOLS])})\\s*\\d[\\d,]*(?:\\.\\d+)?`,
);

/**
 * Verbose units users sometimes type out (English + Swahili).
 */
export const CURRENCY_VERBOSE_RE =
  /[\d,]+\s*(?:shillings?|shilingi|laki|elfu|milioni|bilioni|naira|rand|cedi|pound|euro|dollar)s?\b/i;

/**
 * The full set every PII scrubber should run when deciding if a numeric
 * substring is monetary. Consumers iterate this array and `.test()` each.
 */
export const MONETARY_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  CURRENCY_CODE_RE,
  CURRENCY_SYMBOL_RE,
  CURRENCY_VERBOSE_RE,
]);
