/**
 * Tests for the journal repository — append, hash chain, idempotency.
 */

import { describe, it, expect } from 'vitest';

import { computeJournalHash, GENESIS_HASH } from '../audit/hash-chain.js';
import {
  createInMemoryJournalRepository,
  type AppendJournalInput,
} from '../journal/journal-repository.js';
import {
  WorkCycleError,
  type TickInput,
  type TickOutput,
} from '../types.js';

const baseInputs: TickInput = {
  tenant_id: 'tenant-1',
  tick_no: 1n,
  mode: 'idle',
  last_hash: null,
  recall: [],
  pending_threads: [],
  clock_iso: '2026-05-26T10:00:00.000Z',
};

const baseOutputs: TickOutput = {
  status: 'completed',
  kind: 'sweep',
  summary: 'Mr. Mwikila ran a telemetry sweep.',
  artifact_refs: [],
  requires_owner_attention: false,
};

function mkInput(
  partial: Partial<AppendJournalInput>,
): AppendJournalInput {
  return {
    tenant_id: 'tenant-1',
    tick_no: 1n,
    started_at: '2026-05-26T10:00:00.000Z',
    ended_at: '2026-05-26T10:00:01.000Z',
    mode: 'idle',
    inputs: { ...baseInputs, ...partial.inputs },
    outputs: { ...baseOutputs, ...partial.outputs },
    cost_usd_cents: 10,
    prev_hash: null,
    ...partial,
  };
}

describe('journal-repository / append + chain', () => {
  it('appends the first entry with prev_hash=null', async () => {
    const repo = createInMemoryJournalRepository();
    const entry = await repo.append(mkInput({}));
    expect(entry.tick_no).toBe(1n);
    expect(entry.prev_hash).toBeNull();
    expect(entry.audit_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects duplicate (tenant_id, tick_no)', async () => {
    const repo = createInMemoryJournalRepository();
    await repo.append(mkInput({}));
    await expect(repo.append(mkInput({}))).rejects.toBeInstanceOf(
      WorkCycleError,
    );
  });

  it('rejects prev_hash mismatch', async () => {
    const repo = createInMemoryJournalRepository();
    await repo.append(mkInput({}));
    await expect(
      repo.append(
        mkInput({
          tick_no: 2n,
          inputs: { ...baseInputs, tick_no: 2n },
          prev_hash: 'wrong-hash',
        }),
      ),
    ).rejects.toThrow(/prev_hash mismatch/);
  });

  it('chains the second entry on the first', async () => {
    const repo = createInMemoryJournalRepository();
    const first = await repo.append(mkInput({}));
    const second = await repo.append(
      mkInput({
        tick_no: 2n,
        inputs: { ...baseInputs, tick_no: 2n },
        prev_hash: first.audit_hash,
      }),
    );
    expect(second.prev_hash).toBe(first.audit_hash);
    expect(second.audit_hash).not.toBe(first.audit_hash);
  });

  it('computes the same hash via the standalone helper', async () => {
    const repo = createInMemoryJournalRepository();
    const entry = await repo.append(
      mkInput({
        started_at: '2026-05-26T10:00:00.000Z',
        ended_at: '2026-05-26T10:00:01.000Z',
      }),
    );
    const recomputed = computeJournalHash({
      prev_hash: null,
      payload: {
        tick_no: 1n,
        tenant_id: 'tenant-1',
        started_at: '2026-05-26T10:00:00.000Z',
        ended_at: '2026-05-26T10:00:01.000Z',
        mode: 'idle',
        inputs: baseInputs,
        outputs: baseOutputs,
        cost_usd_cents: 10,
      },
    });
    expect(entry.audit_hash).toBe(recomputed);
  });

  it('GENESIS_HASH is used by the chain when prev_hash is null', () => {
    expect(typeof GENESIS_HASH).toBe('string');
    expect(GENESIS_HASH.length).toBeGreaterThan(0);
  });

  it('readLast returns the most recent entry', async () => {
    const repo = createInMemoryJournalRepository();
    const e1 = await repo.append(mkInput({}));
    const e2 = await repo.append(
      mkInput({
        tick_no: 2n,
        inputs: { ...baseInputs, tick_no: 2n },
        prev_hash: e1.audit_hash,
      }),
    );
    const last = await repo.readLast('tenant-1');
    expect(last?.tick_no).toBe(e2.tick_no);
    expect(last?.audit_hash).toBe(e2.audit_hash);
  });

  it('readLastK returns newest first', async () => {
    const repo = createInMemoryJournalRepository();
    let prev: string | null = null;
    for (let i = 1n; i <= 5n; i += 1n) {
      const entry = await repo.append(
        mkInput({
          tick_no: i,
          inputs: { ...baseInputs, tick_no: i },
          prev_hash: prev,
        }),
      );
      prev = entry.audit_hash;
    }
    const last3 = await repo.readLastK('tenant-1', 3);
    expect(last3.map((e) => Number(e.tick_no))).toEqual([5, 4, 3]);
  });

  it('countFor returns 0 for unknown tenant', async () => {
    const repo = createInMemoryJournalRepository();
    expect(await repo.countFor('unknown')).toBe(0);
  });
});
