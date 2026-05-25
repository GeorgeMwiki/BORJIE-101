/**
 * Hashed audit chain — SOC-2 + GDPR Article 30 grade ordering.
 *
 * Each entry stores the SHA-256 of:
 *   (previousHash || runId || kind || JSON.stringify(payload) || recordedAt.toISOString())
 *
 * which gives a tamper-evident chain: changing any past entry
 * invalidates every subsequent hash. The repository keeps a per-tenant
 * head pointer (latestHashForTenant) so concurrent runs from the same
 * tenant still produce a single linear chain.
 *
 * The chain seed is the literal string "GENESIS" — written nowhere
 * special, just the documented head before the first event.
 */

import { createHash } from 'node:crypto';
import type {
  AuditChainEntry,
  AuditChainRepository,
  WorkflowRunEventKind,
} from '../types.js';

export interface AuditHashChain {
  append(
    tenantId: string,
    runId: string,
    kind: WorkflowRunEventKind,
    payload: Record<string, unknown>,
    entryId: string,
    now: () => Date,
  ): Promise<AuditChainEntry>;
}

export function createAuditHashChain(
  repository: AuditChainRepository,
): AuditHashChain {
  return {
    async append(tenantId, runId, kind, payload, entryId, now) {
      const previousHash = await repository.latestHashForTenant(tenantId);
      const recordedAt = now();
      const body = JSON.stringify({
        previousHash,
        runId,
        kind,
        payload,
        recordedAt: recordedAt.toISOString(),
      });
      const currentHash = createHash('sha256').update(body).digest('hex');
      const entry: AuditChainEntry = Object.freeze({
        id: entryId,
        runId,
        tenantId,
        previousHash,
        currentHash,
        recordedKind: kind,
        recordedPayload: Object.freeze({ ...payload }),
        recordedAt,
      });
      await repository.insert(entry);
      return entry;
    },
  };
}

/**
 * Replay-time verification. Walks a tenant's chain and confirms every
 * entry's `previousHash` matches the prior entry's `currentHash` and
 * that the body hashes match the stored `currentHash`.
 */
export async function verifyChainForRun(
  repository: AuditChainRepository,
  runId: string,
): Promise<{ ok: boolean; brokenAt: string | null }> {
  const entries = await repository.listForRun(runId);
  let previous = entries[0]?.previousHash ?? 'GENESIS';
  for (const e of entries) {
    if (e.previousHash !== previous) {
      return { ok: false, brokenAt: e.id };
    }
    const body = JSON.stringify({
      previousHash: e.previousHash,
      runId: e.runId,
      kind: e.recordedKind,
      payload: e.recordedPayload,
      recordedAt: e.recordedAt.toISOString(),
    });
    const recomputed = createHash('sha256').update(body).digest('hex');
    if (recomputed !== e.currentHash) {
      return { ok: false, brokenAt: e.id };
    }
    previous = e.currentHash;
  }
  return { ok: true, brokenAt: null };
}
