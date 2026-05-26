/**
 * Twilio Voice salted-hash PII redactor.
 *
 * Targets: phone numbers — `from`, `to`, `caller`, `called`, plus any
 * E.164-shaped string in transcript text. Recording URIs are KEPT (the
 * URI is itself signed by Twilio with an expiring auth and contains no
 * raw PII).
 *
 * Note: this redactor runs at the ingest boundary BEFORE persistence;
 * the `voice_calls` table column `from_phone` therefore stores the
 * salted hash, not the cleartext.
 */

import { createHash } from 'node:crypto';

import type { SaltProvider } from '../types.js';

export const VOICE_PII_FIELDS: ReadonlyArray<string> = [
  'from',
  'to',
  'caller',
  'called',
  'from_phone',
  'to_phone',
];

const E164_PATTERN = /\+\d{8,15}/g;

export interface SaltedHashRedactorDeps {
  readonly tenantId: string;
  readonly saltProvider: SaltProvider;
  readonly fields?: ReadonlyArray<string>;
  /** When true, transcript-style free text is scanned for E.164 phone numbers and they are replaced inline. */
  readonly redactPhonesInFreeText?: boolean;
  readonly freeTextFields?: ReadonlyArray<string>;
}

export interface SaltedHashRedactor {
  readonly redact: <T>(payload: T) => Promise<{
    readonly redacted: T;
    readonly redactedFields: ReadonlyArray<string>;
  }>;
}

export function createSaltedHashRedactor(deps: SaltedHashRedactorDeps): SaltedHashRedactor {
  const fields = new Set((deps.fields ?? VOICE_PII_FIELDS).map((f) => f.toLowerCase()));
  const freeText = new Set((deps.freeTextFields ?? ['transcript', 'transcript_text', 'body']).map((f) => f.toLowerCase()));
  const scanFree = deps.redactPhonesInFreeText ?? true;
  return {
    async redact<T>(payload: T) {
      const salt = await deps.saltProvider.forTenant(deps.tenantId);
      const hits: string[] = [];
      const redacted = walk(payload, '', fields, freeText, scanFree, salt, hits) as T;
      return { redacted, redactedFields: hits };
    },
  };
}

function hashWithSalt(salt: string, v: string): string {
  return createHash('sha256').update(salt).update(':').update(v).digest('hex');
}

function walk(
  value: unknown,
  path: string,
  fields: ReadonlySet<string>,
  freeText: ReadonlySet<string>,
  scanFree: boolean,
  salt: string,
  hits: string[],
): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v, i) => walk(v, `${path}[${i}]`, fields, freeText, scanFree, salt, hits));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const child = path === '' ? k : `${path}.${k}`;
      const lowerKey = k.toLowerCase();
      if (fields.has(lowerKey) && typeof v === 'string') {
        out[k] = `sha256:${hashWithSalt(salt, v)}`;
        hits.push(child);
      } else if (scanFree && freeText.has(lowerKey) && typeof v === 'string') {
        const scanned = v.replace(E164_PATTERN, (m) => `sha256:${hashWithSalt(salt, m)}`);
        if (scanned !== v) hits.push(child);
        out[k] = scanned;
      } else {
        out[k] = walk(v, child, fields, freeText, scanFree, salt, hits);
      }
    }
    return out;
  }
  return value;
}
