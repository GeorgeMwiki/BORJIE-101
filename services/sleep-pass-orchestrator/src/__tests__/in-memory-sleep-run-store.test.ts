/**
 * Tests for the in-memory SleepRunStore fallback (LP-21).
 *
 * Mirrors the durable store's contract so swapping backends never changes
 * tick behaviour:
 *   - happy path: begin → record → finalize, with lastRunAt reflecting the row.
 *   - single-flight: a fresh `running` row → beginRun returns null.
 *   - stale-row rescue: an old `running` row is reaped, a fresh row inserted.
 */

import { describe, expect, it } from 'vitest';
import { createInMemorySleepRunStore } from '../in-memory-sleep-run-store.js';
import type { SleepRunFinalize } from '../types.js';

const FINAL: SleepRunFinalize = {
  status: 'done',
  itemsProcessed: 3,
  itemsEmitted: 1,
  durationMs: 42,
  notes: 'ok',
};

describe('createInMemorySleepRunStore — happy path', () => {
  it('begins, records, finalizes, and reports lastRunAt', async () => {
    let now = 1_000_000;
    const store = createInMemorySleepRunStore({ nowMs: () => now });

    expect(await store.lastRunAt('p1')).toBeNull();

    const runId = await store.beginRun('p1');
    expect(runId).not.toBeNull();
    expect(await store.lastRunAt('p1')).toBe(new Date(now).toISOString());

    await store.recordEmissions(runId, [{ kind: 'lesson', payload: { a: 1 } }]);
    await store.finalizeRun(runId, FINAL);
    // Finalizing does not erase the started-at history.
    expect(await store.lastRunAt('p1')).toBe(new Date(now).toISOString());

    // A subsequent run for the same pass advances lastRunAt.
    now += 60_000;
    const runId2 = await store.beginRun('p1');
    expect(runId2).not.toBe(runId);
    expect(await store.lastRunAt('p1')).toBe(new Date(now).toISOString());
  });

  it('no-ops emissions/finalize when runId is null', async () => {
    const store = createInMemorySleepRunStore();
    await expect(
      store.recordEmissions(null, [{ kind: 'x', payload: 1 }]),
    ).resolves.toBeUndefined();
    await expect(store.finalizeRun(null, FINAL)).resolves.toBeUndefined();
  });
});

describe('createInMemorySleepRunStore — single-flight + rescue', () => {
  it('returns null when a fresh running row exists', async () => {
    const now = 10_000;
    const store = createInMemorySleepRunStore({
      rescueAgeMs: 60_000,
      nowMs: () => now,
    });
    const first = await store.beginRun('p1');
    expect(first).not.toBeNull();
    // Same pass, still running, fresh → skip.
    const second = await store.beginRun('p1');
    expect(second).toBeNull();
  });

  it('reaps a stale running row and inserts a fresh one', async () => {
    let now = 0;
    const store = createInMemorySleepRunStore({
      rescueAgeMs: 30 * 60 * 1000,
      nowMs: () => now,
    });
    const first = await store.beginRun('p1');
    expect(first).not.toBeNull();
    // Advance past the rescue window → the stuck row is reaped, fresh inserted.
    now = 60 * 60 * 1000;
    const second = await store.beginRun('p1');
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it('tracks distinct passes independently', async () => {
    const now = 5_000;
    const store = createInMemorySleepRunStore({ nowMs: () => now });
    const a = await store.beginRun('p1');
    const b = await store.beginRun('p2');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
  });
});
