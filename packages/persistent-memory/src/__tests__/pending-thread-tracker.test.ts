import { describe, it, expect } from 'vitest';
import {
  createPendingThreadInsert,
  createPendingThreadResolve,
} from '../threads/pending-thread-tracker.js';
import { createInMemoryPendingThreadRepository } from '../storage/pending-thread-repository.js';
import { createInMemoryAuditChain } from '../audit/audit-chain-link.js';
import { PersistentMemoryError, type MemoryWriteContext } from '../types.js';

const ctx: MemoryWriteContext = {
  tenant_id: 't1',
  user_id: 'u1',
  session_id: 's1',
  thread_id: 'th1',
  now: () => new Date('2026-05-26T10:00:00Z'),
};

describe('pending-thread-tracker', () => {
  it('inserts a pending thread with an audit hash and lists it as unresolved', async () => {
    const repo = createInMemoryPendingThreadRepository();
    const audit = createInMemoryAuditChain();
    const insert = createPendingThreadInsert({ repo, audit });

    const p = await insert(ctx, {
      pending_kind: 'decision',
      payload: { question: 'Confirm FX exposure?' },
    });

    expect(p.resolved_at).toBeNull();
    expect(p.audit_hash).toMatch(/^pm-chain-/);
    expect(p.pending_kind).toBe('decision');

    const unresolved = await repo.listUnresolved('t1', 'u1');
    expect(unresolved.length).toBe(1);
    expect(unresolved[0]?.id).toBe(p.id);
  });

  it('rejects an unknown pending_kind', async () => {
    const repo = createInMemoryPendingThreadRepository();
    const audit = createInMemoryAuditChain();
    const insert = createPendingThreadInsert({ repo, audit });

    await expect(
      // @ts-expect-error -- intentionally invalid pending_kind to exercise the runtime guard
      insert(ctx, { pending_kind: 'nope', payload: {} }),
    ).rejects.toBeInstanceOf(PersistentMemoryError);
  });

  it('resolves a pending thread and removes it from unresolved list', async () => {
    const repo = createInMemoryPendingThreadRepository();
    const audit = createInMemoryAuditChain();
    const insert = createPendingThreadInsert({ repo, audit });
    const resolve = createPendingThreadResolve({ repo, audit });

    const p = await insert(ctx, {
      pending_kind: 'approval',
      payload: { needs: 'signature' },
    });

    await resolve(
      { tenant_id: 't1', now: () => new Date('2026-05-26T11:00:00Z') },
      p.id,
    );

    const unresolved = await repo.listUnresolved('t1', 'u1');
    expect(unresolved.length).toBe(0);
  });
});
