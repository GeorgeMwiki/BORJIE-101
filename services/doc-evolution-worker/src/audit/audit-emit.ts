/**
 * audit-emit — hash-chain entries for every worker decision.
 *
 * The worker emits four kinds of audit payloads:
 *   - `doc_evo.lock_decision` — recipe lock fired.
 *   - `doc_evo.improve_proposal` — improvement proposal emitted.
 *   - `doc_evo.proposal_review` — owner approved/rejected a proposal.
 *   - `doc_evo.tier2_queue_enqueue` — Tier-2 artifact pushed to owner queue.
 *
 * The chain itself is persisted by the caller (see spec §5 — audit chain
 * is `packages/audit-hash-chain/`). This module is a thin wrapper that
 * computes the next chain entry and yields it; persistence is the
 * concern of the consuming repository.
 */

import {
  appendEntry,
  type ChainEntry,
  type AuditPayload,
} from '@borjie/audit-hash-chain';

export type AuditEventKind =
  | 'doc_evo.lock_decision'
  | 'doc_evo.improve_proposal'
  | 'doc_evo.proposal_review'
  | 'doc_evo.tier2_queue_enqueue'
  | 'doc_evo.proposal_promotion';

export interface AuditEmitInput {
  readonly kind: AuditEventKind;
  readonly tenant_id: string;
  readonly subject: Readonly<Record<string, unknown>>;
  readonly chain: ReadonlyArray<ChainEntry>;
  readonly secret_id?: string;
  readonly secret_value?: string;
}

export interface AuditEmitResult {
  readonly chain: ReadonlyArray<ChainEntry>;
  readonly entry: ChainEntry;
}

/**
 * Append a single new chain entry derived from the worker's decision.
 *
 * Returns the new chain (immutable copy). Caller persists it.
 */
export function emitAuditEntry(input: AuditEmitInput): AuditEmitResult {
  const payload: AuditPayload = {
    kind: input.kind,
    tenant_id: input.tenant_id,
    subject: input.subject,
    emitted_at: new Date().toISOString(),
  };
  const next = appendEntry(input.chain, payload, {
    ...(input.secret_id !== undefined ? { secretId: input.secret_id } : {}),
    ...(input.secret_value !== undefined
      ? { secretValue: input.secret_value }
      : {}),
  });
  const entry = next[next.length - 1];
  if (entry === undefined) {
    throw new Error('audit-emit: appendEntry returned empty chain');
  }
  return { chain: next, entry };
}
