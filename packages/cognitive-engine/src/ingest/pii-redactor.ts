/**
 * PII redactor — Discipline 6 boundary check.
 *
 * Mirrors the patterns in `packages/file-ingest/src/schema-sniff/pii-redactor.ts`
 * (Borjie's canonical PII patterns: KRA-PIN, NIDA, +254/+255 mobile,
 * email, generic 9+-digit national id). Copied here intentionally — the
 * cognitive-engine package is a leaf and may not depend backward on
 * file-ingest (same rule that file-ingest enforces against database).
 *
 * Any drift produces inconsistent redaction between the cognitive
 * ingest path and the file-ingest path. Keep in sync.
 *
 * @module @borjie/cognitive-engine/ingest/pii-redactor
 */

import type { PiiRedaction } from '../types.js';

interface PiiPattern {
  readonly kind: string;
  readonly regex: RegExp;
  readonly replacement: string;
}

const PII_PATTERNS: ReadonlyArray<PiiPattern> = [
  // KRA PIN — A123456789B
  { kind: 'kra_pin', regex: /\b[A-Z]\d{9}[A-Z]\b/g, replacement: '[KRA_PIN]' },
  // NIDA — YYYY-MMDD-NNNNN-NNNNNNN
  {
    kind: 'nida',
    regex: /\b(?:19|20)\d{2}-\d{4}-\d{5}-\d{7}\b/g,
    replacement: '[NIDA]',
  },
  {
    kind: 'nida_no_dashes',
    regex: /\b(?:19|20)\d{2}\d{4}\d{5}\d{7}\b/g,
    replacement: '[NIDA]',
  },
  // +254 Kenya mobile — `\b` does not match the boundary before `+`,
  // so we anchor on a non-digit (or start of string) lookbehind.
  { kind: 'phone_ke', regex: /(?<!\d)\+254\d{9}(?!\d)/g, replacement: '[PHONE]' },
  // +255 Tanzania mobile
  { kind: 'phone_tz', regex: /(?<!\d)\+255\d{9}(?!\d)/g, replacement: '[PHONE]' },
  // Local 0-prefixed 10-digit
  { kind: 'phone_local', regex: /(?<!\d)0\d{9}(?!\d)/g, replacement: '[PHONE]' },
  // Email
  {
    kind: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[EMAIL]',
  },
];

export interface RedactResult {
  readonly redacted: string;
  readonly redactions: ReadonlyArray<PiiRedaction>;
}

export function redactPii(text: string, fieldPath: string = '$'): RedactResult {
  if (!text) return { redacted: text, redactions: [] };
  const counts = new Map<string, number>();
  let out = text;
  for (const p of PII_PATTERNS) {
    let count = 0;
    out = out.replace(p.regex, () => {
      count += 1;
      return p.replacement;
    });
    if (count > 0) {
      counts.set(p.kind, (counts.get(p.kind) ?? 0) + count);
    }
  }
  const redactions: ReadonlyArray<PiiRedaction> = Array.from(counts.entries()).map(
    ([kind, count]) => ({
      field_path: fieldPath,
      pattern_kind: kind,
      count,
    }),
  );
  return { redacted: out, redactions };
}
