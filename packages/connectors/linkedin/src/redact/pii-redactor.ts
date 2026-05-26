/**
 * PII redactor for LinkedIn payloads.
 *
 * Free-text bodies pass through pattern redactor.
 * LinkedIn member URNs (`urn:li:person:XXX`) are salted-hashed.
 */

import { createHmac } from 'node:crypto';

const NIDA_PATTERN = /\b\d{8,12}-?\d{4,6}-?\d{4,6}\b/g;
const PHONE_PATTERN = /\b\+?\d[\d\s\-()]{6,}\d\b/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PERSON_URN = /urn:li:person:([A-Za-z0-9_-]{1,40})/g;

export function redactFreeText(text: string): string {
  return text
    .replace(NIDA_PATTERN, '[REDACTED_NIDA]')
    .replace(PHONE_PATTERN, '[REDACTED_PHONE]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');
}

export function hashUrn(salt: string, id: string): string {
  const h = createHmac('sha256', salt);
  h.update(id.toLowerCase().trim());
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
  body = body.replace(PERSON_URN, (_, id: string) =>
    `urn:li:person:${hashUrn(params.salt, id)}`,
  );
  return redactFreeText(body);
}
