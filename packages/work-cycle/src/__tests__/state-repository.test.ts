/**
 * Tests for the state repository — applyTickResult monotonicity +
 * switchMode + read-or-default genesis projection.
 */

import { describe, it, expect } from 'vitest';

import { createInMemoryStateRepository } from '../state/state-repository.js';
import { WorkCycleError } from '../types.js';

describe('state-repository', () => {
  it('readOrDefault returns genesis when unknown', async () => {
    const repo = createInMemoryStateRepository();
    const state = await repo.readOrDefault('tenant-x');
    expect(state.tenant_id).toBe('tenant-x');
    expect(state.last_tick_no).toBe(0n);
    expect(state.last_tick_at).toBeNull();
    expect(state.current_mode).toBe('idle');
    expect(state.pending_threads).toEqual([]);
  });

  it('applyTickResult advances last_tick_no monotonically', async () => {
    const repo = createInMemoryStateRepository();
    const a = await repo.applyTickResult({
      tenantId: 't1',
      tickNo: 1n,
      tickAtIso: '2026-05-26T10:00:00.000Z',
      nextMode: 'idle',
      pendingThreads: [],
    });
    expect(a.last_tick_no).toBe(1n);
    const b = await repo.applyTickResult({
      tenantId: 't1',
      tickNo: 2n,
      tickAtIso: '2026-05-26T10:05:00.000Z',
      nextMode: 'idle',
      pendingThreads: [],
    });
    expect(b.last_tick_no).toBe(2n);
  });

  it('rejects non-monotonic tick_no', async () => {
    const repo = createInMemoryStateRepository();
    await repo.applyTickResult({
      tenantId: 't1',
      tickNo: 1n,
      tickAtIso: '2026-05-26T10:00:00.000Z',
      nextMode: 'idle',
      pendingThreads: [],
    });
    // Re-applying 1n should throw (expected 2n).
    await expect(
      repo.applyTickResult({
        tenantId: 't1',
        tickNo: 1n,
        tickAtIso: '2026-05-26T10:05:00.000Z',
        nextMode: 'idle',
        pendingThreads: [],
      }),
    ).rejects.toBeInstanceOf(WorkCycleError);
    // Skipping 2n and jumping to 5n should throw.
    await expect(
      repo.applyTickResult({
        tenantId: 't1',
        tickNo: 5n,
        tickAtIso: '2026-05-26T10:05:00.000Z',
        nextMode: 'idle',
        pendingThreads: [],
      }),
    ).rejects.toThrow(/expected tick_no 2 got 5/);
  });

  it('switchMode changes mode without advancing tick_no', async () => {
    const repo = createInMemoryStateRepository();
    await repo.applyTickResult({
      tenantId: 't1',
      tickNo: 1n,
      tickAtIso: '2026-05-26T10:00:00.000Z',
      nextMode: 'idle',
      pendingThreads: [],
    });
    const switched = await repo.switchMode('t1', 'night');
    expect(switched.current_mode).toBe('night');
    expect(switched.last_tick_no).toBe(1n);
  });

  it('switchMode rejects unknown mode', async () => {
    const repo = createInMemoryStateRepository();
    await expect(
      // @ts-expect-error - intentional bad mode for runtime check
      repo.switchMode('t1', 'banana'),
    ).rejects.toBeInstanceOf(WorkCycleError);
  });

  it('preserves pending_threads through applyTickResult', async () => {
    const repo = createInMemoryStateRepository();
    const threads = [
      { id: 'th-1', title: 'Watch BoT gold window' },
      { id: 'th-2', title: 'Investigate moisture spike' },
    ];
    const state = await repo.applyTickResult({
      tenantId: 't1',
      tickNo: 1n,
      tickAtIso: '2026-05-26T10:00:00.000Z',
      nextMode: 'night',
      pendingThreads: threads,
    });
    expect(state.pending_threads).toEqual(threads);
  });

  it('isolates state per tenant', async () => {
    const repo = createInMemoryStateRepository();
    await repo.applyTickResult({
      tenantId: 'a',
      tickNo: 1n,
      tickAtIso: '2026-05-26T10:00:00.000Z',
      nextMode: 'idle',
      pendingThreads: [],
    });
    const b = await repo.readOrDefault('b');
    expect(b.last_tick_no).toBe(0n);
  });
});
