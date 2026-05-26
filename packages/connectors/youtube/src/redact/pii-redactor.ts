/**
 * PII redactor for YouTube payloads.
 *
 * Free-text descriptions pass through pattern redactor.
 * YouTube channel IDs (UC...22-chars) are salted-hashed.
 */

import { createHmac } from 'node:crypto';

const NIDA_PATTERN = /\b\d{8,12}-?\d{4,6}-?\d{4,6}\b/g;
const PHONE_PATTERN = /\b\+?\d[\d\s\-()]{6,}\d\b/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const YT_CHANNEL_PATTERN = /\bUC[A-Za-z0-9_-]{22}\b/g;

export function redactFreeText(text: string): string {
  return text
    .replace(NIDA_PATTERN, '[REDACTED_NIDA]')
    .replace(PHONE_PATTERN, '[REDACTED_PHONE]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');
}

export function hashChannelId(salt: string, id: string): string {
  const h = createHmac('sha256', salt);
  h.update(id.toLowerCase().trim());
  return `UC_h_${h.digest('hex').slice(0, 16)}`;
}

export interface RedactDescriptionParams {
  readonly description: string | null;
  readonly salt: string;
}

export function redactDescription(
  params: RedactDescriptionParams,
): string | null {
  if (params.description === null) return null;
  let body = params.description;
  body = body.replace(YT_CHANNEL_PATTERN, (match) =>
    hashChannelId(params.salt, match),
  );
  return redactFreeText(body);
}
