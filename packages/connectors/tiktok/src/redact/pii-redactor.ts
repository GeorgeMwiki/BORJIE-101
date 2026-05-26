/**
 * PII redactor for TikTok payloads.
 *
 * Two-stage redaction per OMNI-P2 spec §4:
 *   - Free-text captions: NIDA, phone, email patterns -> placeholders.
 *   - `@handles` are salted-hashed with a per-tenant salt.
 *
 * Hash uses HMAC-SHA-256 via Node's crypto.
 */

import { createHmac } from 'node:crypto';

const NIDA_PATTERN = /\b\d{8,12}-?\d{4,6}-?\d{4,6}\b/g;
const PHONE_PATTERN = /\b\+?\d[\d\s\-()]{6,}\d\b/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redactFreeText(text: string): string {
  return text
    .replace(NIDA_PATTERN, '[REDACTED_NIDA]')
    .replace(PHONE_PATTERN, '[REDACTED_PHONE]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');
}

export function hashUsername(salt: string, handle: string): string {
  const h = createHmac('sha256', salt);
  h.update(handle.toLowerCase().trim());
  return `h_${h.digest('hex').slice(0, 16)}`;
}

export interface RedactCaptionParams {
  readonly caption: string | null;
  readonly salt: string;
}

export function redactCaption(
  params: RedactCaptionParams,
): string | null {
  if (params.caption === null) return null;
  let body = params.caption;
  body = body.replace(/@([A-Za-z0-9_.]{2,30})/g, (_, handle: string) =>
    `@${hashUsername(params.salt, handle)}`,
  );
  return redactFreeText(body);
}
