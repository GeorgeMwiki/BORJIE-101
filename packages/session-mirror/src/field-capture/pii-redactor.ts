/**
 * PII redactor — Tier-II boundary.
 *
 * Mirrors the conservative pattern set in
 * `apps/admin-web/src/lib/sensorium/pii-redactor.ts` but operates on
 * the VALUE itself (not just on the shape) — this layer is the
 * value-bearing complement to the sensorium's shape-only stream.
 *
 * The redactor classifies a value into a `PiiKind` and, when the value
 * is sensitive, returns a salted hash that the MD can still use for
 * identity matching (lookups against hashed columns in `buyers`,
 * `workers`, etc.). The raw string never leaves the browser when
 * `piiKind !== 'none'`.
 *
 * The hash is intentionally simple — `sha256(tenant_id ':' field_id
 * ':' value)`. The salt is `tenant_id + field_id`, so the same value
 * in a different tenant or different field is unlinkable.
 */

import type { FieldValue, PiiKind } from '../types.js';

// Pattern order matters — more specific shapes come first so that
// (e.g.) a NIDA-formatted string is not classified as `phone` first.
const PATTERNS: ReadonlyArray<{ kind: PiiKind; re: RegExp }> = [
  { kind: 'email', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { kind: 'nida', re: /\b\d{8}-\d{5}-\d{5}-\d{2}\b/ },
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/ },
  { kind: 'kra-pin', re: /\b[A-Z]\d{9}[A-Z]\b/i },
  { kind: 'passport', re: /\b[A-Z]{1,2}\d{6,9}\b/ },
  { kind: 'tin', re: /\b\d{3}-?\d{3}-?\d{3}\b/ },
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded, no nested groups
  { kind: 'card', re: /(?:\d[ -]?){13,19}/ },
  { kind: 'phone', re: /\+?\d[\d\s().-]{6,18}\d/ },
  { kind: 'mpesa', re: /\b[A-Z0-9]{10}\b/ },
];

/** Classify a raw value into a PII kind. Returns `'none'` for safe values. */
export function classify(value: unknown): PiiKind {
  if (typeof value !== 'string') return 'none';
  if (value.length < 4) return 'none';
  for (const p of PATTERNS) {
    if (p.re.test(value)) return p.kind;
  }
  return 'none';
}

export interface RedactArgs {
  readonly tenantId: string;
  readonly tabId: string;
  readonly fieldId: string;
  readonly fieldType?: string | undefined;
  readonly value: string;
  /** Test seam — defaults to the browser's SubtleCrypto sha256. */
  readonly hasher?: (input: string) => Promise<string>;
}

/**
 * Reduce a captured field to a `FieldValue` ready to ship. When the
 * value (or the field's `type` attribute) is sensitive, the plaintext
 * is dropped and `valueHash` is set instead.
 */
export async function redact(args: RedactArgs): Promise<FieldValue> {
  const piiByType =
    typeof args.fieldType === 'string' &&
    /^(password|credit|cc|cvv|ssn|tel)$/i.test(args.fieldType);
  const piiKind: PiiKind = piiByType ? 'card' : classify(args.value);
  const capturedAt = new Date().toISOString();

  if (piiKind === 'none') {
    return {
      tabId: args.tabId,
      fieldId: args.fieldId,
      capturedAt,
      valuePlaintext: args.value,
      piiKind,
    };
  }

  const hasher = args.hasher ?? defaultSha256;
  const salted = `${args.tenantId}:${args.fieldId}:${args.value}`;
  const valueHash = await hasher(salted);
  return {
    tabId: args.tabId,
    fieldId: args.fieldId,
    capturedAt,
    valueHash,
    piiKind,
  };
}

/**
 * Default sha256 hasher. Uses `crypto.subtle.digest` when available
 * (browser + Node 18+). Falls back to a non-cryptographic
 * deterministic hash for unit tests where the WebCrypto surface is
 * mocked away — the fallback is clearly marked so callers can swap
 * in a real hasher via the `hasher` arg in production paths.
 */
async function defaultSha256(input: string): Promise<string> {
  if (
    typeof globalThis !== 'undefined' &&
    typeof globalThis.crypto?.subtle?.digest === 'function'
  ) {
    const buf = new TextEncoder().encode(input);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Deterministic non-cryptographic fallback — visible prefix so it is
  // obvious when this path runs in production logs.
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return `dev-fallback-${(h >>> 0).toString(16).padStart(8, '0')}`;
}
