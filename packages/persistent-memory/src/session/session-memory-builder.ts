/**
 * Session-memory builder (Wave 18GG).
 *
 * Composes a new `SessionMemory` row from the latest turn outcome.
 * Pure orchestration — the host wires in the repository and the
 * audit chain.
 */

import {
  PersistentMemoryError,
  type ActiveDecision,
  type AuditChainPort,
  type MemoryWriteContext,
  type PendingQuestion,
  type SessionMemory,
  type SessionMemoryRepository,
} from '../types.js';
import { computeSessionExpiry } from './ttl-policy.js';

export interface SessionMemoryUpsertInput {
  readonly summary_md: string;
  readonly active_decisions: ReadonlyArray<ActiveDecision>;
  readonly pending_questions: ReadonlyArray<PendingQuestion>;
  readonly ttl_days?: number;
}

export interface SessionMemoryBuilderDeps {
  readonly repo: SessionMemoryRepository;
  readonly audit: AuditChainPort;
}

export type SessionMemoryUpsertFn = (
  ctx: MemoryWriteContext,
  input: SessionMemoryUpsertInput,
) => Promise<SessionMemory>;

export function createSessionMemoryUpsert(
  deps: SessionMemoryBuilderDeps,
): SessionMemoryUpsertFn {
  return async (ctx, input) => {
    if (!ctx.tenant_id) {
      throw new PersistentMemoryError('tenant_id required', 'MISSING_TENANT');
    }
    if (!input.summary_md) {
      throw new PersistentMemoryError(
        'summary_md must not be empty',
        'INVALID_INPUT',
      );
    }

    const now = ctx.now();
    const expiresAt = computeSessionExpiry({
      now,
      ...(input.ttl_days !== undefined ? { ttl_days: input.ttl_days } : {}),
    });

    const id = cryptoRandomId('sm');
    const payloadDigest = digestSummary(input.summary_md);

    const auditHash = await deps.audit.append({
      tenant_id: ctx.tenant_id,
      event_kind: 'session.upsert',
      entity_id: id,
      recorded_at: now.toISOString(),
      payload_digest: payloadDigest,
    });

    const row: SessionMemory = {
      id,
      tenant_id: ctx.tenant_id,
      session_id: ctx.session_id,
      user_id: ctx.user_id,
      thread_id: ctx.thread_id,
      summary_md: input.summary_md,
      active_decisions: input.active_decisions,
      pending_questions: input.pending_questions,
      last_turn_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      audit_hash: auditHash,
    };

    await deps.repo.upsert(row);
    return row;
  };
}

function cryptoRandomId(prefix: string): string {
  const u32 = () => Math.floor(Math.random() * 0xffffffff).toString(16);
  return `${prefix}_${Date.now().toString(16)}_${u32()}${u32()}`;
}

function digestSummary(summary: string): string {
  // Cheap deterministic digest for the in-package audit hash; the
  // production wiring uses the canonical sha256 from
  // @borjie/audit-hash-chain when assembling the chain row.
  let hash = 0;
  for (let i = 0; i < summary.length; i += 1) {
    hash = ((hash << 5) - hash + summary.charCodeAt(i)) | 0;
  }
  return `digest_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
