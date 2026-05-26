/**
 * Zoom salted-hash PII redactor.
 *
 * Targets: participant `email`, `user_email`, `host_email`. Participant
 * `name` is KEPT (Mr. Mwikila needs to see who attended). Transcript
 * `text` passes through unchanged at the field level — the connector
 * applies a separate token-level redaction on transcript content where
 * email / phone strings are detected (delegated to the kernel
 * `chat-corpus-evidence` redactor; outside this package).
 */

import { createHash } from 'node:crypto';

import type { SaltProvider } from '../types.js';

export const ZOOM_PII_FIELDS: ReadonlyArray<string> = [
  'email',
  'user_email',
  'host_email',
  'phone',
];

export interface SaltedHashRedactorDeps {
  readonly tenantId: string;
  readonly saltProvider: SaltProvider;
  readonly fields?: ReadonlyArray<string>;
}

export interface SaltedHashRedactor {
  readonly redact: <T>(payload: T) => Promise<{
    readonly redacted: T;
    readonly redactedFields: ReadonlyArray<string>;
  }>;
}

export function createSaltedHashRedactor(deps: SaltedHashRedactorDeps): SaltedHashRedactor {
  const fields = new Set((deps.fields ?? ZOOM_PII_FIELDS).map((f) => f.toLowerCase()));
  return {
    async redact<T>(payload: T) {
      const salt = await deps.saltProvider.forTenant(deps.tenantId);
      const hits: string[] = [];
      const redacted = walk(payload, '', fields, salt, hits) as T;
      return { redacted, redactedFields: hits };
    },
  };
}

function hashWithSalt(salt: string, v: string): string {
  return createHash('sha256').update(salt).update(':').update(v).digest('hex');
}

function walk(value: unknown, path: string, fields: ReadonlySet<string>, salt: string, hits: string[]): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v, i) => walk(v, `${path}[${i}]`, fields, salt, hits));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const child = path === '' ? k : `${path}.${k}`;
      if (fields.has(k.toLowerCase()) && typeof v === 'string') {
        out[k] = `sha256:${hashWithSalt(salt, v)}`;
        hits.push(child);
      } else {
        out[k] = walk(v, child, fields, salt, hits);
      }
    }
    return out;
  }
  return value;
}
