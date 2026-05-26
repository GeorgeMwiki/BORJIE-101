/**
 * PII redactor for Instagram payloads.
 *
 * Two-stage redaction per spec §4:
 *
 *   - Free-text bodies (captions, comment bodies) pass through a
 *     pattern redactor (NIDA, phone, email).
 *   - Joinable identifiers (commenter usernames) are salted-hashed
 *     with a per-tenant salt loaded from the encrypted credential
 *     store.
 *
 * The hash uses HMAC-SHA-256 via Node's crypto (no external deps).
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
  // Replace @-mentions with hashed handles.
  body = body.replace(/@([A-Za-z0-9_.]{2,30})/g, (_, handle: string) =>
    `@${hashUsername(params.salt, handle)}`,
  );
  return redactFreeText(body);
}
