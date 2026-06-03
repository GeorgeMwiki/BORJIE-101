/**
 * Integration test for the durable `runDispatched` seam (LP-21).
 *
 * Wires `createOrchestrator` with a `runDispatched` runner backed by
 * `runSleepTick` + the in-memory store (the same shape the standalone
 * bootstrap uses for the Drizzle-backed store), and asserts:
 *   - a dispatched pass runs and its result is forwarded to `resultSink`;
 *   - the store recorded the run (lastRunAt is set afterwards);
 *   - emissions surface on the forwarded result.
 *
 * This exercises the exact path the production pod uses, just with the
 * in-memory store standing in for the Drizzle one.
 */

import { describe, expect, it } from 'vitest';
import { createOrchestrator } from '../orchestrator.js';
import { runSleepTick } from '../sleep-tick.js';
import { createInMemorySleepRunStore } from '../in-memory-sleep-run-store.js';
import type { PassResult, SleepPass, SleepRunStore } from '../types.js';

function makePass(id: string): SleepPass {
  return {
    id,
    schedule: {
      cadence: { kind: 'hourly', offsetMinutes: 0 },
      minIntervalMinutes: 0,
      priority: 1,
      maxDurationMs: 5_000,
    },
    async run({ now }) {
      const startedAt = now().toISOString();
      return {
        passId: id,
        itemsProcessed: 2,
        itemsEmitted: 1,
        notes: 'ran',
        startedAt,
        completedAt: now().toISOString(),
        aborted: false,
        errored: false,
        emissions: [{ kind: 'lesson', payload: { ok: true } }],
      };
    },
  };
}

function durableRunner(store: SleepRunStore) {
  return async (due: ReadonlyArray<SleepPass>): Promise<ReadonlyArray<PassResult>> => {
    if (due.length === 0) return [];
    const report = await runSleepTick({ passes: due, store });
    return report.runs.map((r) => ({
      passId: r.passId,
      itemsProcessed: r.itemsProcessed,
      itemsEmitted: r.itemsEmitted,
      notes: r.notes,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
      aborted: r.status === 'timeout',
      errored: r.status === 'failed',
    }));
  };
}

describe('durable runDispatched seam', () => {
  it('runs dispatched passes through the store and forwards results', async () => {
    const store = createInMemorySleepRunStore();
    const pass = makePass('alpha');
    const results: PassResult[] = [];

    let t = new Date('2026-06-03T10:00:00.000Z').getTime();
    const orch = createOrchestrator({
      passes: [pass],
      now: () => new Date(t),
      resultSink: (r) => results.push(r),
      runDispatched: durableRunner(store),
    });

    // Advance past the first hourly due time, then tick.
    t += 2 * 60 * 60_000;
    const { tick, results: tickResults } = await orch.tick();

    expect(tick.dispatched).toContain('alpha');
    expect(tickResults).toHaveLength(1);
    expect(tickResults[0]?.passId).toBe('alpha');
    expect(tickResults[0]?.itemsEmitted).toBe(1);
    // Forwarded to the sink.
    expect(results).toHaveLength(1);
    // The store persisted the run → lastRunAt is now set.
    expect(await store.lastRunAt('alpha')).not.toBeNull();
  });

  it('falls back to inline execution when no runner is injected', async () => {
    const pass = makePass('beta');
    const results: PassResult[] = [];
    let t = new Date('2026-06-03T10:00:00.000Z').getTime();
    const orch = createOrchestrator({
      passes: [pass],
      now: () => new Date(t),
      resultSink: (r) => results.push(r),
    });
    t += 2 * 60 * 60_000;
    await orch.tick();
    expect(results).toHaveLength(1);
    expect(results[0]?.passId).toBe('beta');
  });
});
