/**
 * Tests for the Wave-3 reflexion-consolidation sleep pass.
 *
 * Asserts the closure-plan invariants:
 *   - REACHABLE: the pass runs and aggregates per-tenant consolidation
 *     counts (it is a real registered pass, not a stub).
 *   - NIGHTLY cadence (off the hot turn path): the schedule is daily.
 *   - FAIL-SAFE: a per-tenant runner failure is non-fatal — the run
 *     completes and continues to the next tenant.
 *   - COOPERATIVE ABORT: an aborted signal short-circuits the loop.
 */

import { describe, expect, it } from 'vitest';
import {
  createReflexionConsolidationPass,
  createInMemoryReflexionRunner,
  type ReflexionConsolidationRunner,
} from '../reflexion-consolidation.js';

const now = () => new Date('2026-06-09T04:15:00.000Z');
const liveSignal = new AbortController().signal;

describe('reflexion-consolidation pass', () => {
  it('schedules nightly (off the hot turn path)', () => {
    const pass = createReflexionConsolidationPass(
      createInMemoryReflexionRunner([]),
    );
    expect(pass.id).toBe('reflexion-consolidation');
    expect(pass.schedule.cadence.kind).toBe('daily');
  });

  it('returns a zero-tenant result when no tenants are listed', async () => {
    const pass = createReflexionConsolidationPass(
      createInMemoryReflexionRunner([]),
    );
    const result = await pass.run({ abortSignal: liveSignal, now });
    expect(result.itemsProcessed).toBe(0);
    expect(result.itemsEmitted).toBe(0);
    expect(result.errored).toBe(false);
    expect(result.notes).toMatch(/tenants=0/);
  });

  it('aggregates consolidation counts across tenants', async () => {
    const runner = createInMemoryReflexionRunner([
      { tenantId: 't1', clustered: 12, guidelinesWritten: 3, pruned: 5 },
      { tenantId: 't2', clustered: 8, guidelinesWritten: 1, pruned: 2 },
    ]);
    const pass = createReflexionConsolidationPass(runner);
    const result = await pass.run({ abortSignal: liveSignal, now });
    expect(result.itemsProcessed).toBe(20); // clustered
    expect(result.itemsEmitted).toBe(4); // guidelines written
    expect(result.notes).toMatch(/pruned=7/);
    expect(result.errored).toBe(false);
    // Idempotency surface: each tenant consolidated exactly once.
    expect(runner.callsFor('t1')).toBe(1);
    expect(runner.callsFor('t2')).toBe(1);
  });

  it('fail-safe: a per-tenant runner throw does not abort the run', async () => {
    const flaky: ReflexionConsolidationRunner = {
      async listTenants() {
        return ['good', 'bad', 'good2'];
      },
      async runForTenant({ tenantId }) {
        if (tenantId === 'bad') throw new Error('tenant consolidation blew up');
        return {
          tenantId,
          clustered: 1,
          guidelinesWritten: 1,
          pruned: 0,
          errors: [],
        };
      },
    };
    const pass = createReflexionConsolidationPass(flaky);
    const result = await pass.run({ abortSignal: liveSignal, now });
    // Run completes despite the bad tenant; counts the two good ones.
    expect(result.errored).toBe(false);
    expect(result.itemsProcessed).toBe(2);
    expect(result.notes).toMatch(/tenantErrors=1/);
  });

  it('cooperative abort short-circuits the tenant loop', async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = createInMemoryReflexionRunner([
      { tenantId: 't1', clustered: 12, guidelinesWritten: 3, pruned: 5 },
    ]);
    const pass = createReflexionConsolidationPass(runner);
    const result = await pass.run({ abortSignal: controller.signal, now });
    expect(result.aborted).toBe(true);
    expect(runner.callsFor('t1')).toBe(0);
  });
});
