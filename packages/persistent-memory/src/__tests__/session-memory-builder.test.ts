import { describe, it, expect } from 'vitest';
import { createSessionMemoryUpsert } from '../session/session-memory-builder.js';
import { createSessionRecall } from '../session/session-recall.js';
import { createInMemorySessionMemoryRepository } from '../storage/session-memory-repository.js';
import { createInMemoryAuditChain } from '../audit/audit-chain-link.js';
import { PersistentMemoryError, type MemoryWriteContext } from '../types.js';

const fixedNow = (): Date => new Date('2026-05-26T10:00:00Z');

const ctx: MemoryWriteContext = {
  tenant_id: 't1',
  user_id: 'u1',
  session_id: 's1',
  thread_id: 'th1',
  now: fixedNow,
};

describe('session-memory-builder', () => {
  it('upserts a session-memory row with an audit hash and sliding TTL', async () => {
    const repo = createInMemorySessionMemoryRepository();
    const audit = createInMemoryAuditChain();
    const upsert = createSessionMemoryUpsert({ repo, audit });

    const row = await upsert(ctx, {
      summary_md: 'Owner planning Q3 brief.',
      active_decisions: [],
      pending_questions: [],
    });

    expect(row.tenant_id).toBe('t1');
    expect(row.summary_md).toBe('Owner planning Q3 brief.');
    expect(row.audit_hash).toMatch(/^pm-chain-/);
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(
      fixedNow().getTime(),
    );

    const stored = await repo.findByThread('t1', 'th1');
    expect(stored).not.toBeNull();
    expect(stored?.id).toBe(row.id);
  });

  it('rejects empty summary', async () => {
    const repo = createInMemorySessionMemoryRepository();
    const audit = createInMemoryAuditChain();
    const upsert = createSessionMemoryUpsert({ repo, audit });

    await expect(
      upsert(ctx, {
        summary_md: '',
        active_decisions: [],
        pending_questions: [],
      }),
    ).rejects.toBeInstanceOf(PersistentMemoryError);
  });

  it('recall returns null when no row exists', async () => {
    const repo = createInMemorySessionMemoryRepository();
    const recall = createSessionRecall({ repo });
    const result = await recall('t1', 'th1', fixedNow());
    expect(result).toBeNull();
  });

  it('recall returns null when row has expired', async () => {
    const repo = createInMemorySessionMemoryRepository();
    const audit = createInMemoryAuditChain();
    const upsert = createSessionMemoryUpsert({ repo, audit });
    const recall = createSessionRecall({ repo });

    await upsert(
      { ...ctx, now: () => new Date('2026-01-01T00:00:00Z') },
      {
        summary_md: 'old',
        active_decisions: [],
        pending_questions: [],
        ttl_days: 1,
      },
    );

    const result = await recall('t1', 'th1', new Date('2026-05-26T00:00:00Z'));
    expect(result).toBeNull();
  });
});
