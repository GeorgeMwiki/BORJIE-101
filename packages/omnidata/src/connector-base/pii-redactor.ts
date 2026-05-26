/**
 * Omnidata-side wrapper around the shared
 * `packages/observability/src/pii-redactor.ts` boundary redactor.
 *
 * The orchestrator MUST call `boundaryRedact` on every payload before
 * persisting an `OmnidataIngestedItem`. The redactor adapter is
 * injectable so tests can pass a deterministic stub; production wires
 * the real `redactPii` from observability.
 */

import type { PIIRedactor } from '../types.js';

/**
 * Walks a value, replacing any object key in the provided set
 * (case-insensitive) with a `[REDACTED:<key>]` sentinel. Returns the
 * redacted value plus the dot-path list of redacted fields for the
 * `redaction_applied` audit field.
 *
 * Reference implementation. Production wires `redactPii` from
 * `packages/observability`.
 */
export function createDefaultPIIRedactor(fields: ReadonlyArray<string>): PIIRedactor {
  const lookup = new Set(fields.map((f) => f.toLowerCase()));

  function walk(value: unknown, path: string, hits: string[]): unknown {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
      return value.map((v, i) => walk(v, `${path}[${i}]`, hits));
    }
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (lookup.has(k.toLowerCase())) {
          out[k] = `[REDACTED:${k}]`;
          hits.push(path === '' ? k : `${path}.${k}`);
        } else {
          out[k] = walk(v, path === '' ? k : `${path}.${k}`, hits);
        }
      }
      return out;
    }
    return value;
  }

  return {
    redact<T>(payload: T): { readonly redacted: T; readonly redactedFields: ReadonlyArray<string> } {
      const hits: string[] = [];
      const redacted = walk(payload, '', hits) as T;
      return { redacted, redactedFields: hits };
    },
  };
}

/**
 * Default Borjie boundary PII set. Mirrors the superset in
 * `packages/observability/src/pii-redactor.ts` but kept local so the
 * omnidata scaffold has zero hard dependency at type-check time.
 */
export const DEFAULT_BOUNDARY_PII_FIELDS: ReadonlyArray<string> = [
  // Auth
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'apiKey',
  'authorization',
  'secret',
  'clientSecret',
  // PII
  'email',
  'phone',
  'phoneNumber',
  'recipient',
  'recipientPhone',
  'recipientEmail',
  // TZ-specific
  'nida',
  'nidaNumber',
  'tin',
  'tinNumber',
  'kraPin',
  'mpesaNumber',
  // Banking
  'iban',
  'accountNumber',
  'cardNumber',
  'cvv',
];
