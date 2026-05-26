import { describe, it, expect } from 'vitest';
import {
  planSummarisation,
  createSummarise,
} from '../summarisation/memgpt-summariser.js';
import { createInMemoryThreadSummaryRepository } from '../storage/thread-summary-repository.js';
import { createInMemoryAuditChain } from '../audit/audit-chain-link.js';
import { PersistentMemoryError } from '../types.js';

describe('memgpt-summariser', () => {
  it('plans a summarisation block once the threshold is reached', () => {
    const turns = [
      { seq: 1, token_count: 60_000 },
      { seq: 2, token_count: 60_000 },
      { seq: 3, token_count: 60_000 },
      { seq: 4, token_count: 60_000 },
    ];
    const plan = planSummarisation(turns, 200_000);
    expect(plan).not.toBeNull();
    expect(plan?.start_seq).toBe(1);
    expect(plan?.end_seq).toBe(4);
    expect(plan?.token_count_original).toBeGreaterThanOrEqual(200_000);
  });

  it('returns null when no contiguous block reaches the threshold', () => {
    const turns = [
      { seq: 1, token_count: 30_000 },
      { seq: 2, token_count: 30_000 },
    ];
    const plan = planSummarisation(turns, 200_000);
    expect(plan).toBeNull();
  });

  it('persists a thread summary with an audit hash', async () => {
    const repo = createInMemoryThreadSummaryRepository();
    const audit = createInMemoryAuditChain();
    const summarise = createSummarise({ repo, audit });

    const row = await summarise({
      tenant_id: 't1',
      thread_id: 'th1',
      summary_md: 'Compressed history of turns 1-12.',
      plan: { start_seq: 1, end_seq: 12, token_count_original: 230_000 },
      token_count_summary: 4_000,
      now: new Date('2026-05-26T10:00:00Z'),
    });

    expect(row.thread_id).toBe('th1');
    expect(row.audit_hash).toMatch(/^pm-chain-/);
    expect(row.summarised_turn_range).toEqual([1, 12]);

    const latest = await repo.latest('t1', 'th1');
    expect(latest?.id).toBe(row.id);
  });

  it('refuses an empty summary', async () => {
    const repo = createInMemoryThreadSummaryRepository();
    const audit = createInMemoryAuditChain();
    const summarise = createSummarise({ repo, audit });

    await expect(
      summarise({
        tenant_id: 't1',
        thread_id: 'th1',
        summary_md: '',
        plan: { start_seq: 1, end_seq: 12, token_count_original: 230_000 },
        token_count_summary: 0,
        now: new Date('2026-05-26T10:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(PersistentMemoryError);
  });

  it('refuses an inverted range', async () => {
    const repo = createInMemoryThreadSummaryRepository();
    const audit = createInMemoryAuditChain();
    const summarise = createSummarise({ repo, audit });

    await expect(
      summarise({
        tenant_id: 't1',
        thread_id: 'th1',
        summary_md: 'ok',
        plan: { start_seq: 12, end_seq: 1, token_count_original: 230_000 },
        token_count_summary: 4_000,
        now: new Date('2026-05-26T10:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(PersistentMemoryError);
  });
});
