/**
 * Boundary PII redactor for Slack message text.
 *
 * Follows the `packages/session-mirror/src/field-capture/pii-redactor.ts`
 * pattern: detects PII shapes (email, phone, NIDA, KRA PIN, IBAN,
 * M-Pesa transaction codes) and replaces each match with a
 * salted-sha256 hash. The salt is `tenant_id ':' field_id ':' value`
 * so the same value in a different tenant or different field is
 * unlinkable.
 *
 * Only the redacted text leaves the connector boundary. The raw
 * plaintext is never persisted in `slack_messages`.
 */

import type { Hasher } from '../types.js';

interface PiiPattern {
  readonly kind: string;
  readonly re: RegExp;
}

const PATTERNS: ReadonlyArray<PiiPattern> = [
  { kind: 'email', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi },
  { kind: 'nida', re: /\b\d{8}-\d{5}-\d{5}-\d{2}\b/g },
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  { kind: 'kra-pin', re: /\b[AP]\d{9}[A-Z]\b/g },
  { kind: 'mpesa', re: /\b[A-Z]{2}\d{8}[A-Z]{2}\b/g },
  { kind: 'phone', re: /\+?\d[\d\s().-]{6,18}\d/g },
];

export interface RedactInput {
  readonly tenantId: string;
  readonly fieldId: string;
  readonly value: string;
}

export interface RedactResult {
  readonly redacted: string;
  readonly redactedFields: ReadonlyArray<string>;
}

export interface PiiRedactorDeps {
  readonly hasher: Hasher;
}

export function createPiiRedactor(deps: PiiRedactorDeps) {
  return {
    redact: async (input: RedactInput): Promise<RedactResult> => {
      let redacted = input.value;
      const fields = new Set<string>();

      for (const { kind, re } of PATTERNS) {
        const matches = redacted.match(re);
        if (matches === null) continue;
        const uniqueMatches = Array.from(new Set(matches));
        for (const match of uniqueMatches) {
          const salt = `${input.tenantId}:${input.fieldId}:${match}`;
          const hash = await deps.hasher(salt);
          const token = `[${kind}:${hash.slice(0, 12)}]`;
          // Replace ALL occurrences without regex injection risk.
          redacted = redacted.split(match).join(token);
          fields.add(kind);
        }
      }

      return { redacted, redactedFields: Array.from(fields) };
    },
  };
}

export type PiiRedactor = ReturnType<typeof createPiiRedactor>;
