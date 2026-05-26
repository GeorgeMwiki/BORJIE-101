/**
 * HubSpot salted-hash PII redactor.
 *
 * `email`, `phone`, `mobilephone`, `address`, `notes_last_contacted`
 * are salted-hashed; `firstname`, `lastname`, `company` are kept so
 * Mr. Mwikila can identify accounts at a glance.
 */

import { createHash } from 'node:crypto';

import type { SaltProvider } from '../types.js';

export const HUBSPOT_PII_FIELDS: ReadonlyArray<string> = [
  'email',
  'phone',
  'mobilephone',
  'address',
  'street',
  'notes_last_contacted',
  'notes_last_updated',
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

export function createSaltedHashRedactor(
  deps: SaltedHashRedactorDeps,
): SaltedHashRedactor {
  const fields = new Set((deps.fields ?? HUBSPOT_PII_FIELDS).map((f) => f.toLowerCase()));
  return {
    async redact<T>(payload: T) {
      const salt = await deps.saltProvider.forTenant(deps.tenantId);
      const hits: string[] = [];
      const redacted = walk(payload, '', fields, salt, hits) as T;
      return { redacted, redactedFields: hits };
    },
  };
}

function hashWithSalt(salt: string, value: string): string {
  return createHash('sha256').update(salt).update(':').update(value).digest('hex');
}

function walk(
  value: unknown,
  path: string,
  fields: ReadonlySet<string>,
  salt: string,
  hits: string[],
): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v, i) => walk(v, `${path}[${i}]`, fields, salt, hits));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path === '' ? k : `${path}.${k}`;
      if (fields.has(k.toLowerCase()) && typeof v === 'string') {
        out[k] = `sha256:${hashWithSalt(salt, v)}`;
        hits.push(childPath);
      } else {
        out[k] = walk(v, childPath, fields, salt, hits);
      }
    }
    return out;
  }
  return value;
}
