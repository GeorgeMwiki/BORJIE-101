import { describe, expect, it, vi } from 'vitest';
import { iterateTenants } from '../schedule/tenant-iteration.js';

describe('iterateTenants', () => {
  it('runs every tenant exactly once', async () => {
    const calls: string[] = [];
    await iterateTenants({
      tenantIds: ['t1', 't2', 't3'],
      runForTenant: async (id) => {
        calls.push(id);
        return {
          tenantId: id,
          status: 'ok',
          usersEvaluated: 0,
          triggersFired: 0,
          triggersSuppressedIdempotent: 0,
          triggersSuppressedLowUrgency: 0,
          errorMessage: null,
        };
      },
    });
    expect(calls.sort()).toEqual(['t1', 't2', 't3']);
  });

  it('records errored result when runForTenant throws', async () => {
    const results = await iterateTenants({
      tenantIds: ['t1'],
      runForTenant: async () => {
        throw new Error('boom');
      },
    });
    expect(results[0]?.status).toBe('error');
    expect(results[0]?.errorMessage).toContain('boom');
  });

  it('honours concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const ids = Array.from({ length: 10 }, (_, i) => `t${i}`);
    await iterateTenants({
      tenantIds: ids,
      concurrency: 3,
      runForTenant: async (id) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return {
          tenantId: id,
          status: 'ok',
          usersEvaluated: 0,
          triggersFired: 0,
          triggersSuppressedIdempotent: 0,
          triggersSuppressedLowUrgency: 0,
          errorMessage: null,
        };
      },
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('logs and continues when one tenant blows up', async () => {
    const warn = vi.fn();
    const results = await iterateTenants({
      tenantIds: ['t1', 't2'],
      logger: { info: () => {}, warn },
      runForTenant: async (id) => {
        if (id === 't1') throw new Error('explode');
        return {
          tenantId: id,
          status: 'ok',
          usersEvaluated: 1,
          triggersFired: 0,
          triggersSuppressedIdempotent: 0,
          triggersSuppressedLowUrgency: 0,
          errorMessage: null,
        };
      },
    });
    expect(results).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
  });
});
