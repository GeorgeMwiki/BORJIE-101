/**
 * PII regex patterns for the 5 Borjie jurisdictions.
 *
 * Covers:
 *   - Email addresses
 *   - International phone numbers (+254... / +255... / +256... etc.)
 *   - Credit card numbers (Luhn-validated)
 *   - National IDs:
 *       * TZ NIDA (20-digit National Identification)
 *       * KE Huduma (9-digit National Identification)
 *       * UG NIN (14-character National Identification)
 *       * NG NIN (11-digit National Identification)
 *       * RW National ID (16-digit)
 *
 * All patterns use `.replace()` (idempotent) — never `.test()` on a
 * global regex (LITFIN iter-44 HIGH #7 lesson).
 */

export interface PiiPattern {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}

export const PII_PATTERNS: ReadonlyArray<PiiPattern> = Object.freeze([
  // Email
  {
    name: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[REDACTED_EMAIL]',
  },
  // Credit cards (basic 13-19 digits, optional separators; Luhn check
  // done by `redactCreditCards` to avoid false positives on e.g.
  // M-Pesa transaction IDs).
  {
    name: 'credit_card',
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    replacement: '[REDACTED_CARD]',
  },
  // TZ NIDA — 20 digits, often in groups of 5 (e.g. 19900101-12345-12345-12)
  {
    name: 'tz_nida',
    pattern: /\b\d{8}[- ]?\d{5}[- ]?\d{5}[- ]?\d{2}\b/g,
    replacement: '[REDACTED_NIDA]',
  },
  // RW National ID — 16 digits, REQUIRE separators (1-1-8-1-5) so a
  // run of 16 contiguous digits (likely a card number that failed
  // Luhn validation) does not get false-redacted as a national ID.
  {
    name: 'rw_nid',
    pattern: /\b\d[- ]\d[- ]\d{8}[- ]\d[- ]\d{5}\b/g,
    replacement: '[REDACTED_NID]',
  },
  // UG NIN — 14-char alphanumeric (starts with C* or M*)
  {
    name: 'ug_nin',
    pattern: /\b[CMF][A-Z0-9]{13}\b/g,
    replacement: '[REDACTED_NIN]',
  },
  // International phone numbers (+254xxx, +255xxx, +256xxx, +250xxx, +234xxx, +xxx generic)
  {
    name: 'phone_international',
    pattern: /\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3}[\s-]?\d{3,4}/g,
    replacement: '[REDACTED_PHONE]',
  },
  // Bare 10-digit local numbers (07xxxxxxxx for TZ/KE/UG)
  {
    name: 'phone_local',
    pattern: /\b0[67]\d{8}\b/g,
    replacement: '[REDACTED_PHONE]',
  },
  // KE Huduma / NG NIN — 9-11 digit standalone (LAST, to avoid stealing card matches)
  {
    name: 'ke_huduma_or_ng_nin',
    pattern: /\b\d{9,11}\b/g,
    replacement: '[REDACTED_NID]',
  },
]);

/**
 * Luhn algorithm — used to verify a digit run is actually a credit card
 * before redacting. Prevents false positives on long transaction IDs.
 */
function isValidLuhn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number.parseInt(digits[i]!, 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Apply Luhn-validated card redaction first (it's the only one that
 * needs validation), then everything else.
 */
export function scrubPiiText(input: string): string {
  if (!input) return input;
  let out = input;

  // 1. Luhn-validated card numbers
  const cardPattern = PII_PATTERNS.find((p) => p.name === 'credit_card')!;
  out = out.replace(cardPattern.pattern, (match) =>
    isValidLuhn(match) ? cardPattern.replacement : match,
  );

  // 2. All other patterns (skip credit_card — handled above)
  for (const p of PII_PATTERNS) {
    if (p.name === 'credit_card') continue;
    out = out.replace(p.pattern, p.replacement);
  }

  return out;
}
