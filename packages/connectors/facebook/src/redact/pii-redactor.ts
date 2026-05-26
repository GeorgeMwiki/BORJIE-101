/**
 * PII redactor for Facebook payloads.
 *
 * Same two-stage discipline as the Instagram connector — pattern
 * redaction for free text, salted-hash for joinable identifiers.
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

export function hashHandle(salt: string, handle: string): string {
  const h = createHmac('sha256', salt);
  h.update(handle.toLowerCase().trim());
  return `h_${h.digest('hex').slice(0, 16)}`;
}

export interface RedactMessageParams {
  readonly message: string | null;
  readonly salt: string;
}

export function redactMessage(
  params: RedactMessageParams,
): string | null {
  if (params.message === null) return null;
  // @-mentions follow Facebook's notation "@[id:name]" or "@user".
  let body = params.message.replace(
    /@\[(\d+):([^\]]+)\]/g,
    (_, _id: string, name: string) =>
      `@${hashHandle(params.salt, name)}`,
  );
  body = body.replace(/@([A-Za-z0-9_.]{2,40})/g, (_, h: string) =>
    `@${hashHandle(params.salt, h)}`,
  );
  return redactFreeText(body);
}
