/**
 * Ledger hash-chain — tamper-evidence for immutable ledger entries.
 *
 * Mirrors the platform-wide `ai_audit_chain` pattern
 * (`@borjie/audit-hash-chain`): each row carries a `prevHash` and a
 * `thisHash = sha256(canonicalJson({ prev, payload }))`. The chain is
 * scoped PER (tenant, account) — the same grain as `sequenceNumber` —
 * so each account's entry stream is independently tamper-evident and
 * verifiable in isolation.
 *
 *   prevHash  = the prior entry's thisHash for this (tenant, account),
 *               or GENESIS_HASH ('') for the first entry.
 *   thisHash  = sha256(canonicalJson({ prev: prevHash, payload })).
 *
 * Pure functions, no I/O. `canonicalJson` keeps the digest stable
 * across Node versions and object-construction order (ported verbatim
 * from `@borjie/audit-hash-chain` so both produce byte-identical
 * canonical forms). We intentionally vendor this rather than depend on
 * `@borjie/audit-hash-chain` to avoid widening the payments-ledger
 * dependency surface — the algorithm is small and frozen.
 *
 * @module @borjie/payments-ledger/services/ledger-hash-chain
 */

import { createHash } from 'node:crypto';
import type {
  AccountId,
  EntryDirection,
  LedgerEntryId,
  LedgerEntryType,
  Money,
  TenantId,
} from '@borjie/domain-models';

/**
 * Structural shape the hash-chain consumes. We bind it structurally
 * (rather than to the domain `LedgerEntry`, which is a `type` alias
 * that can't be widened with the optional chain fields) so the helper
 * stays decoupled and the optional `prevHash`/`thisHash` are
 * first-class. Every immutable financial field the digest commits to
 * is required here.
 */
export interface HashableEntry {
  readonly id: LedgerEntryId | string;
  readonly tenantId: TenantId | string;
  readonly accountId: AccountId | string;
  readonly journalId: string;
  readonly type: LedgerEntryType | string;
  readonly direction: EntryDirection | string;
  readonly amount: Money;
  readonly balanceAfter: Money;
  readonly sequenceNumber: number;
  readonly effectiveDate: Date;
  readonly postedAt: Date;
  readonly paymentIntentId?: string;
  readonly leaseId?: string;
  readonly propertyId?: string;
  readonly unitId?: string;
  /** Prior entry's `thisHash` in this (tenant, account) chain. */
  readonly prevHash?: string | null;
  /** This entry's chain hash. */
  readonly thisHash?: string | null;
}

/**
 * Genesis hash — the `prevHash` of the first entry in any per-account
 * chain. Empty string matches the `@borjie/audit-hash-chain` genesis
 * sentinel and the blackboard-intel `verifyScoreChain` convention.
 */
export const GENESIS_HASH = '';

/**
 * Canonical JSON — keys sorted alphabetically, no whitespace. The hash
 * MUST consume canonical JSON to be stable across Node versions and
 * object-construction order. Ported verbatim from
 * `@borjie/audit-hash-chain/canonical-json.ts`.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * The immutable financial substance of a ledger entry that the hash
 * commits to. We deliberately bind every field a tamper could alter:
 * identity, money amounts, direction, ordering, dates, and the
 * source/account linkage. `balanceAfter` is included so a forged
 * running balance is detectable. Timestamps are serialised as ISO
 * strings for a stable canonical form across Date instances.
 */
function hashPayload(
  entry: HashableEntry,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: entry.id,
    tenantId: entry.tenantId,
    accountId: entry.accountId,
    journalId: entry.journalId,
    type: entry.type,
    direction: entry.direction,
    amountMinorUnits: entry.amount.amountMinorUnits,
    currency: entry.amount.currency,
    balanceAfterMinorUnits: entry.balanceAfter.amountMinorUnits,
    sequenceNumber: entry.sequenceNumber,
    effectiveDate: entry.effectiveDate.toISOString(),
    postedAt: entry.postedAt.toISOString(),
    paymentIntentId: entry.paymentIntentId ?? null,
    leaseId: entry.leaseId ?? null,
    propertyId: entry.propertyId ?? null,
    unitId: entry.unitId ?? null,
  });
}

/**
 * Compute the `thisHash` for an entry given the prior entry's hash.
 * Pure and deterministic over (prevHash, entry).
 */
export function computeEntryHash(
  prevHash: string,
  entry: HashableEntry,
): string {
  const canonical = canonicalJson({
    prev: prevHash,
    payload: hashPayload(entry),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Result of verifying a per-account hash chain. On failure, surfaces
 * the first broken entry id plus the expected/actual hashes so the
 * caller can drop a structured log row pointing at the tampered entry.
 */
export type HashChainVerification =
  | { readonly ok: true; readonly scanned: number }
  | {
      readonly ok: false;
      readonly scanned: number;
      readonly badEntryId: string;
      readonly reason: 'prev_hash_mismatch' | 'this_hash_mismatch';
      readonly expectedHash: string;
      readonly actualHash: string;
    };

/**
 * Verify a per-account chain segment. Entries MUST be supplied in
 * ascending `sequenceNumber` order (persistence order). Recomputes
 * each `thisHash` and asserts the `prevHash` linkage, returning the
 * first broken entry or `{ ok: true }` when the chain is intact.
 *
 * Entries whose `thisHash` is undefined (legacy rows written before
 * the chain landed) are skipped for recomputation but still advance
 * `prev` as GENESIS so a contiguous suffix of chained rows verifies.
 */
export function verifyHashChain(
  entries: ReadonlyArray<HashableEntry>,
): HashChainVerification {
  let prev: string = GENESIS_HASH;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const storedThis = entry.thisHash;
    const storedPrev = entry.prevHash;

    // Legacy row with no chain fields — cannot verify, treat as a
    // genesis reset for any chained rows that follow it.
    if (storedThis === undefined || storedThis === null) {
      prev = GENESIS_HASH;
      continue;
    }

    const expectedPrev = storedPrev ?? GENESIS_HASH;
    if (expectedPrev !== prev) {
      return {
        ok: false,
        scanned: i,
        badEntryId: String(entry.id),
        reason: 'prev_hash_mismatch',
        expectedHash: prev,
        actualHash: expectedPrev,
      };
    }

    const recomputed = computeEntryHash(prev, entry);
    if (recomputed !== storedThis) {
      return {
        ok: false,
        scanned: i,
        badEntryId: String(entry.id),
        reason: 'this_hash_mismatch',
        expectedHash: recomputed,
        actualHash: storedThis,
      };
    }
    prev = storedThis;
  }
  return { ok: true, scanned: entries.length };
}
