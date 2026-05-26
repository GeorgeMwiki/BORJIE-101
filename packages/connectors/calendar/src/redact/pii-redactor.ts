/**
 * Boundary PII redactor for calendar summary / description and
 * attendee email addresses.
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
  { kind: 'phone', re: /\+?\d[\d\s().-]{6,18}\d/g },
];

const JOIN_URL_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /[?&]pwd=[^&\s]+/gi,
  /[?&]password=[^&\s]+/gi,
  /[?&]token=[^&\s]+/gi,
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
      // Strip embedded auth tokens from join URLs FIRST so we do not
      // accidentally hash them as part of a longer matched substring.
      for (const re of JOIN_URL_TOKEN_PATTERNS) {
        if (re.test(redacted)) {
          redacted = redacted.replace(re, '');
          fields.add('join-url-token');
        }
      }
      for (const { kind, re } of PATTERNS) {
        const matches = redacted.match(re);
        if (matches === null) continue;
        const uniqueMatches = Array.from(new Set(matches));
        for (const match of uniqueMatches) {
          const salt = `${input.tenantId}:${input.fieldId}:${match}`;
          const hash = await deps.hasher(salt);
          const token = `[${kind}:${hash.slice(0, 12)}]`;
          redacted = redacted.split(match).join(token);
          fields.add(kind);
        }
      }
      return { redacted, redactedFields: Array.from(fields) };
    },
    redactAddress: async (params: {
      readonly tenantId: string;
      readonly fieldId: string;
      readonly address: string;
    }): Promise<string> => {
      const salt = `${params.tenantId}:${params.fieldId}:${params.address.toLowerCase()}`;
      const hash = await deps.hasher(salt);
      return `[email:${hash.slice(0, 16)}]`;
    },
  };
}

export type PiiRedactor = ReturnType<typeof createPiiRedactor>;
