/**
 * PII redactor for X (Twitter) payloads.
 *
 * Free-text bodies pass through pattern redactor.
 * @-mentions are salted-hashed.
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

export interface RedactTextParams {
  readonly text: string | null;
  readonly salt: string;
}

export function redactTweetText(
  params: RedactTextParams,
): string | null {
  if (params.text === null) return null;
  let body = params.text;
  body = body.replace(/@([A-Za-z0-9_]{2,15})/g, (_, handle: string) =>
    `@${hashUsername(params.salt, handle)}`,
  );
  return redactFreeText(body);
}
