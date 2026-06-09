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
  // Monotonic-clock guard: `recordedAt` is the chain's total-order key —
  // every read query (`listForRun`, `latestHashForTenant`) and both DB
  // indexes order by it, and `latestHashForTenant` reads the head via
  // `desc(recordedAt) LIMIT 1`. A bursty append sequence can resolve
  // `now()` to the SAME millisecond, which would make that ordering a
  // partial order: `listForRun` could surface entries out of append order
  // (so entry[0] is no longer the GENESIS-anchored head) and the head
  // read could pick the wrong row and silently fork the chain. We stamp
  // each append with a timestamp strictly greater than the previous one
  // so the persisted order is always a faithful total order of the append
  // sequence. The hash still binds `recordedAt`, so tamper-evidence is
  // unchanged — verification recomputes against the stored value.
  let lastStampMs = 0;
  function monotonicNow(now: () => Date): Date {
    const candidate = now().getTime();
    const stampMs = candidate > lastStampMs ? candidate : lastStampMs + 1;
    lastStampMs = stampMs;
    return new Date(stampMs);
  }

  return {
    async append(tenantId, runId, kind, payload, entryId, now) {
      const previousHash = await repository.latestHashForTenant(tenantId);
      const recordedAt = monotonicNow(now);
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
