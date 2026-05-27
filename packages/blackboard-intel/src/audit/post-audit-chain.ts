/**
 * Post audit chain — extends BLACKBOARD-CORE's content audit chain
 * with quality-score links.
 *
 * Wave BLACKBOARD-INTEL. We use the same `chainHash` primitive from
 * `@borjie/audit-hash-chain` as the rest of the platform. Each
 * `PostQualityScore` row carries:
 *
 *   prev_hash  = the audit_hash of the prior score row in the
 *                tenant's chain (or '' for the genesis row).
 *   audit_hash = chainHash({ prev: prev_hash, payload: <row body> }).
 *
 * Verification is pure: given a sequence of rows in
 * persistence-order, recompute each hash and assert it matches.
 *
 * @module @borjie/blackboard-intel/audit/post-audit-chain
 */

import { chainHash } from '@borjie/audit-hash-chain';
import type {
  AuditChainPort,
  PostQualityScore,
} from '../types.js';

/**
 * The default audit-chain port — wraps `@borjie/audit-hash-chain`'s
 * `chainHash`. Tests can swap in a deterministic fixture hasher via
 * the structural `AuditChainPort`.
 */
export function createDefaultAuditChainPort(): AuditChainPort {
  return {
    hash(
      prevHash: string | null,
      payload: Readonly<Record<string, unknown>>,
    ): string {
      return chainHash({
        prev: prevHash ?? '',
        payload,
      });
    },
  };
}

/**
 * Compute the audit hash for a quality-score row. Pure function —
 * deterministic over its inputs.
 */
export function computeScoreAuditHash(
  prevHash: string,
  row: Omit<PostQualityScore, 'auditHash' | 'prevHash'>,
  auditChain: AuditChainPort,
): string {
  const payload: Readonly<Record<string, unknown>> = Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    postId: row.postId,
    axis: row.axis,
    score: row.score,
    scoredAt: row.scoredAt,
    prevHash,
  });
  return auditChain.hash(prevHash, payload);
}

/**
 * Verify a sequence of quality-score rows. The rows MUST be supplied
 * in persistence order — i.e. the order they were written. Returns
 * the first row whose recomputed hash does not match its stored
 * `auditHash`, or null if the chain is intact.
 */
export function verifyScoreChain(
  rows: ReadonlyArray<PostQualityScore>,
  auditChain: AuditChainPort,
): { readonly ok: true } | { readonly ok: false; readonly badRowId: string } {
  let prev = '';
  for (const row of rows) {
    if (row.prevHash !== prev) {
      return Object.freeze({ ok: false as const, badRowId: row.id });
    }
    const recomputed = computeScoreAuditHash(
      prev,
      {
        id: row.id,
        tenantId: row.tenantId,
        postId: row.postId,
        axis: row.axis,
        score: row.score,
        scoredAt: row.scoredAt,
      },
      auditChain,
    );
    if (recomputed !== row.auditHash) {
      return Object.freeze({ ok: false as const, badRowId: row.id });
    }
    prev = row.auditHash;
  }
  return Object.freeze({ ok: true as const });
}
