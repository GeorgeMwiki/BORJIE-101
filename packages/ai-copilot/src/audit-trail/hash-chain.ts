/**
 * Hash-chain helpers for the Audit Trail v2 — Wave 27 Agent C.
 *
 * Pure functions — no I/O, no clocks, no RNG. Given the same inputs, return
 * the same hash + signature.
 *
 *   hashEntry(...)        → deterministic SHA-256 of the canonicalised row
 *   signHash(...)         → HMAC-SHA256(thisHash, secret) — detects signing
 *                           key rotation / impersonation attempts
 *   canonicalEvidence(...) → stable JSON serialisation so object key order
 *                           doesn't change the hash
 */

import { createHash, createHmac } from 'crypto';
import type { AuditActionCategory, AuditActorKind, AuditDecision } from './types.js';

/**
 * Canonicalise a JSON value so key order is deterministic. Numbers/strings/
 * booleans/null are untouched; arrays preserve element order; object keys
 * are sorted. Prevents "{a:1,b:2}" vs "{b:2,a:1}" producing different hashes.
 */
export function canonicalEvidence(value: unknown): string {
  return JSON.stringify(value, replacer);
}

function replacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[k] = (value as Record<string, unknown>)[k];
  }
  return sorted;
}

/** Parameters used to compute `this_hash`. */
export interface HashEntryParams {
  readonly sequenceId: number;
  readonly prevHash: string;
  readonly tenantId: string;
  readonly occurredAt: string;      // ISO-8601
  readonly actorKind: AuditActorKind;
  readonly actionKind: string;
  readonly actionCategory: AuditActionCategory;
  readonly decision: AuditDecision;
  readonly evidence: Readonly<Record<string, unknown>>;
}

/**
 * Deterministic SHA-256 of the row payload. Any mutation (payload, prevHash,
 * sequence skip, actorKind swap) invalidates verification.
 */
export function hashEntry(p: HashEntryParams): string {
  const serialised = [
    String(p.sequenceId),
    p.prevHash,
    p.tenantId,
    p.occurredAt,
    p.actorKind,
    p.actionKind,
    p.actionCategory,
    p.decision,
    canonicalEvidence(p.evidence),
  ].join('|');
  return createHash('sha256').update(serialised).digest('hex');
}

/**
 * HMAC-SHA256 of `thisHash` under `secret`. Returns null if secret is empty
 * — callers decide whether that's acceptable (test/dev yes, prod no).
 */
export function signHash(thisHash: string, secret: string | null | undefined): string | null {
  if (!secret) return null;
  return createHmac('sha256', secret).update(thisHash).digest('hex');
}

/**
 * Verify that a signature matches the secret. Returns `false` on any
 * mismatch. Safe against timing attacks via node's `timingSafeEqual`
 * (HMAC output lengths are constant so there is no length leak).
 */
export function verifySignature(
  thisHash: string,
  signature: string | null,
  secret: string | null | undefined,
): boolean {
  if (!secret) return signature === null;
  if (!signature) return false;
  const expected = signHash(thisHash, secret);
  if (!expected) return false;
  // `timingSafeEqual` requires equal-length buffers; HMAC hex output is
  // always 64 chars so this is safe to call.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  // Use a constant-time comparison for defence in depth.
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Resolve the signing secret from the environment. Callers pass their own
 * env bag so tests can inject a controlled value.
 */
export function resolveSigningSecret(
  env: Readonly<Record<string, string | undefined>>,
  { requireInProd = true }: { readonly requireInProd?: boolean } = {},
): string | null {
  const raw = env.AUDIT_TRAIL_SIGNING_SECRET;
  const value = raw && raw.trim().length > 0 ? raw.trim() : null;
  if (!value && requireInProd && env.NODE_ENV === 'production') {
    throw new Error(
      'audit-trail: AUDIT_TRAIL_SIGNING_SECRET env var is required in production',
    );
  }
  return value;
}
