/**
 * auto-tagger — classify a record into the 8-class lattice.
 *
 * Heuristics-only. The auto-tagger applies regex + field-name rules; the
 * DPO can override per-tenant. Calling code reads the classifier output
 * and writes a `data_classifications` row. See migration 0053.
 *
 * Intentionally jurisdiction-agnostic: no country names, no regulator
 * strings. Field-name patterns mirror the universal "what kind of data
 * is this" question, not "is it covered by X jurisdiction".
 */

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import {
  CLASSIFICATION_PRECEDENCE,
  type Classification,
} from '../types.js';

/** Lower-case substrings that suggest a field is PII. */
const PII_PATTERNS: ReadonlyArray<string> = Object.freeze([
  'email',
  'phone',
  'msisdn',
  'national_id',
  'national-id',
  'ssn',
  'passport',
  'address',
  'geo',
  'lat',
  'lon',
  'birth',
  'dob',
  'voiceprint',
  'biometric',
  'face',
]);

/** Lower-case substrings that suggest a field is PHI (medical). */
const PHI_PATTERNS: ReadonlyArray<string> = Object.freeze([
  'medical',
  'audiometry',
  'silicosis',
  'health',
  'hearing',
  'diagnosis',
  'screening',
  'allergy',
  'medication',
]);

/** Lower-case substrings that suggest a field is financial. */
const FINANCIAL_PATTERNS: ReadonlyArray<string> = Object.freeze([
  'iban',
  'account_number',
  'account-number',
  'card',
  'pan',
  'cvv',
  'balance',
  'invoice',
  'tin',
  'tax_id',
  'tax-id',
  'pension',
  'salary',
  'income',
]);

/** Lower-case substrings that suggest the field is "critical". */
const CRITICAL_PATTERNS: ReadonlyArray<string> = Object.freeze([
  'kill_switch',
  'kill-switch',
  'sovereign_decision',
  'sovereign-decision',
  'audit_secret',
  'audit-secret',
  'kek_material',
  'kek-material',
  'root_credential',
  'root-credential',
]);

export interface FieldDescriptor {
  /** Logical column name (snake_case). */
  readonly name: string;
  /** Optional sample value used to refine the heuristic. */
  readonly sample?: string;
}

/**
 * Score a single field name + sample against the pattern dictionaries.
 * Returns the set of classes the field MIGHT belong to.
 */
export function tagField(field: FieldDescriptor): ReadonlySet<Classification> {
  const matches = new Set<Classification>();
  const haystack = `${field.name.toLowerCase()} ${(field.sample ?? '').toLowerCase()}`;

  if (CRITICAL_PATTERNS.some((p) => haystack.includes(p))) {
    matches.add('critical');
  }
  if (PHI_PATTERNS.some((p) => haystack.includes(p))) {
    matches.add('phi');
  }
  if (PII_PATTERNS.some((p) => haystack.includes(p))) {
    matches.add('pii');
  }
  if (FINANCIAL_PATTERNS.some((p) => haystack.includes(p))) {
    matches.add('financial');
  }
  return matches;
}

/**
 * Collapse a set of candidate classes into the canonical ONE via the
 * precedence table from `types.ts`. If no candidates match, defaults to
 * `'internal'` — the safe "operational, not sensitive" floor.
 */
export function canonicalise(
  candidates: ReadonlySet<Classification>,
  fallback: Classification = 'internal',
): Classification {
  if (candidates.size === 0) {
    return fallback;
  }
  for (const cls of CLASSIFICATION_PRECEDENCE) {
    if (candidates.has(cls)) {
      return cls;
    }
  }
  return fallback;
}

export interface RecordDescriptor {
  /** Tenant scope. */
  readonly tenantId: string;
  /** Entity kind (e.g., `'lease'`, `'tenant_profile'`). */
  readonly entityKind: string;
  /** Logical entity ID inside the tenant scope. */
  readonly entityId: string;
  /** The fields composing the record. */
  readonly fields: ReadonlyArray<FieldDescriptor>;
}

export interface ClassificationResult {
  readonly tenantId: string;
  readonly entityKind: string;
  readonly entityId: string;
  readonly classification: Classification;
  readonly tags: ReadonlySet<Classification>;
  /** SHA-256 over (tenantId, entityKind, entityId, classification, sorted-tags). */
  readonly auditHash: string;
}

/**
 * Classify a record. The function is PURE — no DB writes, no side
 * effects. Calling code persists the `ClassificationResult` into the
 * `data_classifications` table (migration 0053).
 */
export function classifyRecord(
  record: RecordDescriptor,
  fallback: Classification = 'internal',
): ClassificationResult {
  const allTags = new Set<Classification>();
  for (const field of record.fields) {
    for (const t of tagField(field)) {
      allTags.add(t);
    }
  }
  const classification = canonicalise(allTags, fallback);
  const sortedTags = Array.from(allTags).sort();
  const auditHash = bytesToHex(
    sha256(
      utf8ToBytes(
        [
          record.tenantId,
          record.entityKind,
          record.entityId,
          classification,
          sortedTags.join(','),
        ].join('|'),
      ),
    ),
  );
  return {
    tenantId: record.tenantId,
    entityKind: record.entityKind,
    entityId: record.entityId,
    classification,
    tags: allTags,
    auditHash,
  };
}

/**
 * Compute a tenant-scoped PII token via salted SHA-256.
 *
 *     token = sha256(tenant_id || ":" || field_name || ":" || raw_value)
 *
 * Deterministic per `(tenant, field, value)`. NOT reversible without an
 * offline brute-force. Different tenants produce different tokens.
 */
export function tokeniseValue(
  tenantId: string,
  fieldName: string,
  rawValue: string,
): string {
  return bytesToHex(
    sha256(utf8ToBytes(`${tenantId}:${fieldName}:${rawValue}`)),
  );
}
