/**
 * PII redactor — Central Command Phase A (C4 Brain Skin).
 *
 * The sensory bus NEVER sends raw input values to the server. Two
 * guardrails:
 *
 *   1. `hasPii(value)` — detects email, phone, KRA/MRI, NIDA, IBAN-ish,
 *      passport, M-Pesa till/paybill, credit-card-like patterns.
 *   2. `redactToShape(field)` — for `input.change`, returns
 *      `{ fieldName, valueLength, hasPii }` instead of the value.
 *
 * The detector is intentionally permissive: a false positive ("this
 * field LOOKS like an email") is harmless — the bus drops the value
 * either way. A false negative would be a privacy bug, so the regex
 * set errs on the side of flagging.
 */

const PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  // Email — RFC-lite, deliberately loose.
  { name: 'email', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  // International phone — + then 7-15 digits with optional separators.
  { name: 'phone', re: /\+?\d[\d\s().-]{6,18}\d/ },
  // 13-19 digit credit card (PAN) with optional separators.
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded quantifier 13..19, no nested groups, runs on already-buffered ≤8KB telemetry
  { name: 'card', re: /(?:\d[ -]?){13,19}/ },
  // Tanzania NIDA — 20-digit national id.
  { name: 'nida', re: /\b\d{8}-\d{5}-\d{5}-\d{2}\b/ },
  // KRA PIN — letter + 9 digits + letter (Kenya tax id).
  { name: 'kra-pin', re: /\b[A-Z]\d{9}[A-Z]\b/i },
  // Tanzania TIN — 9 digits with optional dashes.
  { name: 'tin', re: /\b\d{3}-?\d{3}-?\d{3}\b/ },
  // IBAN — 2 letters + 2 digits + 11-30 alnum.
  { name: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/ },
  // Passport — 1-2 letters + 6-9 digits.
  { name: 'passport', re: /\b[A-Z]{1,2}\d{6,9}\b/ },
  // M-Pesa transaction code (Tanzania pattern).
  { name: 'mpesa', re: /\b[A-Z0-9]{10}\b/ },
];

/**
 * True when the value matches a heuristic PII pattern. Empty strings,
 * non-strings, and short tokens never match.
 */
export function hasPii(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length < 4) return false;
  for (const p of PATTERNS) {
    if (p.re.test(value)) return true;
  }
  return false;
}

export interface PiiSensitiveField {
  readonly fieldName: string;
  readonly value: string;
  readonly type?: string;
}

export interface RedactedFieldShape {
  readonly fieldName: string;
  readonly valueLength: number;
  readonly hasPii: boolean;
}

/**
 * Reduce a form field to its safe-to-emit shape. Never leaks the value.
 *
 * Password/credit-card type fields ALWAYS flag hasPii=true regardless
 * of content — the type attribute is itself a signal that the value
 * is sensitive (defence in depth against weird browser autocomplete
 * shapes that don't match our pattern set).
 */
export function redactToShape(
  field: PiiSensitiveField,
): RedactedFieldShape {
  const valueLength = typeof field.value === 'string' ? field.value.length : 0;
  const piiByType =
    typeof field.type === 'string' &&
    /^(password|credit|cc|cvv|ssn|tel)$/i.test(field.type);
  return {
    fieldName: field.fieldName.slice(0, 80),
    valueLength,
    hasPii: piiByType || hasPii(field.value),
  };
}

/**
 * Truncate any string emitted to the bus. Keeps the contract tight
 * regardless of which event handler is calling.
 */
export function truncate(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
