/**
 * Salted-hash PII redactor for Notion ingest. Same scheme as the
 * other Phase-0 connectors so cross-source deduplication holds.
 */

import { createHash } from 'node:crypto';

export interface RedactInput {
  readonly tenantId: string;
  readonly fieldPath: string;
  readonly value: string;
}

export function redactValue({
  tenantId,
  fieldPath,
  value,
}: RedactInput): string {
  return createHash('sha256')
    .update(`${tenantId}:${fieldPath}:${value}`)
    .digest('hex');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d[\d\s\-()]{6,}$/;

/**
 * Heuristic — returns true if the value looks like an email or phone.
 * Used to redact freeform property values that are not typed as
 * `email` / `phone_number` upstream but still carry PII.
 */
export function looksLikePii(value: string): boolean {
  const trimmed = value.trim();
  return EMAIL_RE.test(trimmed) || PHONE_RE.test(trimmed);
}
