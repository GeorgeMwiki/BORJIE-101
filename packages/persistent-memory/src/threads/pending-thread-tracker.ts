/**
 * Pending-thread tracker — records open decisions / approvals /
 * data-requests / follow-ups so Mr. Mwikila never loses track of
 * what's outstanding (Wave 18GG).
 */

import {
  PersistentMemoryError,
  pendingThreadInsertSchema,
  type AuditChainPort,
  type MemoryWriteContext,
  type PendingKind,
  type PendingThread,
  type PendingThreadRepository,
} from '../types.js';

export interface PendingThreadTrackerDeps {
  readonly repo: PendingThreadRepository;
  readonly audit: AuditChainPort;
}

export interface PendingThreadInsertInput {
  readonly pending_kind: PendingKind;
  readonly payload: Record<string, unknown>;
}

export type PendingThreadInsertFn = (
  ctx: MemoryWriteContext,
  input: PendingThreadInsertInput,
) => Promise<PendingThread>;

export function createPendingThreadInsert(
  deps: PendingThreadTrackerDeps,
): PendingThreadInsertFn {
  return async (ctx, input) => {
    const parsed = pendingThreadInsertSchema.safeParse({
      tenant_id: ctx.tenant_id,
      user_id: ctx.user_id,
      thread_id: ctx.thread_id,
      pending_kind: input.pending_kind,
      payload: input.payload,
    });
    if (!parsed.success) {
      throw new PersistentMemoryError(
        `pending-thread input invalid: ${parsed.error.message}`,
        'INVALID_INPUT',
      );
    }

    const now = ctx.now();
    const id = `pt_${now.getTime().toString(16)}_${Math.floor(Math.random() * 0xffff).toString(16)}`;
    const auditHash = await deps.audit.append({
      tenant_id: ctx.tenant_id,
      event_kind: 'pending.insert',
      entity_id: id,
      recorded_at: now.toISOString(),
      payload_digest: `${input.pending_kind}_${id}`,
    });

    const row: PendingThread = {
      id,
      tenant_id: ctx.tenant_id,
      user_id: ctx.user_id,
      thread_id: ctx.thread_id,
      pending_kind: input.pending_kind,
      payload: input.payload,
      created_at: now.toISOString(),
      resolved_at: null,
      audit_hash: auditHash,
    };

    await deps.repo.insert(row);
    return row;
  };
}

export type PendingThreadResolveFn = (
  ctx: { readonly tenant_id: string; readonly now: () => Date },
  id: string,
) => Promise<void>;

export function createPendingThreadResolve(
  deps: PendingThreadTrackerDeps,
): PendingThreadResolveFn {
  return async (ctx, id) => {
    const now = ctx.now();
    await deps.audit.append({
      tenant_id: ctx.tenant_id,
      event_kind: 'pending.resolve',
      entity_id: id,
      recorded_at: now.toISOString(),
      payload_digest: `resolve_${id}`,
    });
    await deps.repo.resolve(id, now);
  };
}
