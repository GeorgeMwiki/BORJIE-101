/**
 * step-checkpoint-store tests — the adapter is pure 1:1 routing, so
 * the only behaviour to pin is "every method delegates to the service
 * with the exact arguments it received".
 */
import { describe, it, expect, vi } from 'vitest';
import { createStepCheckpointStore } from '../step-checkpoint-store.js';
import { createAgencyRunCheckpointsService } from '@borjie/database';

// Use ReturnType<typeof factory> to dodge the import-type namespace
// quirk — see step-checkpoint-store.ts for the rationale.
type AgencyRunCheckpointsService = ReturnType<
  typeof createAgencyRunCheckpointsService
>;

function makeServiceStub() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stub: AgencyRunCheckpointsService = {
    recordPending: vi.fn(async (args) => {
      calls.push({ method: 'recordPending', args: [args] });
      return { id: 'cp_1' };
    }),
    recordRunning: vi.fn(async (id) => {
      calls.push({ method: 'recordRunning', args: [id] });
    }),
    recordSuccess: vi.fn(async (id, output) => {
      calls.push({ method: 'recordSuccess', args: [id, output] });
    }),
    recordFailure: vi.fn(async (id, msg) => {
      calls.push({ method: 'recordFailure', args: [id, msg] });
    }),
    recordPaused: vi.fn(async (id, msg) => {
      calls.push({ method: 'recordPaused', args: [id, msg] });
    }),
    listForRun: vi.fn(async (runId) => {
      calls.push({ method: 'listForRun', args: [runId] });
      return [];
    }),
    listStuckRunning: vi.fn(async (args) => {
      calls.push({ method: 'listStuckRunning', args: [args] });
      return [];
    }),
    getById: vi.fn(async (id) => {
      calls.push({ method: 'getById', args: [id] });
      return null;
    }),
  } as never;
  return { stub, calls };
}

describe('createStepCheckpointStore', () => {
  it('routes pending → recordPending', async () => {
    const { stub, calls } = makeServiceStub();
    const store = createStepCheckpointStore(stub);
    await store.pending({
      tenantId: 't1',
      runId: 'r1',
      goalId: 'g1',
      stepIndex: 0,
      stepName: 's',
      inputPayload: { x: 1 },
    });
    expect(calls).toEqual([
      {
        method: 'recordPending',
        args: [
          {
            tenantId: 't1',
            runId: 'r1',
            goalId: 'g1',
            stepIndex: 0,
            stepName: 's',
            inputPayload: { x: 1 },
          },
        ],
      },
    ]);
  });

  it('routes every other method 1:1', async () => {
    const { stub, calls } = makeServiceStub();
    const store = createStepCheckpointStore(stub);
    await store.running('cp_1');
    await store.success('cp_1', { ok: true });
    await store.failure('cp_2', 'boom');
    await store.paused('cp_3', 'retries exhausted');
    await store.listForRun('r1');
    await store.stuckRunning({ olderThan: new Date('2026-05-01T00:00:00Z') });
    await store.getById('cp_5');
    expect(calls.map((c) => c.method)).toEqual([
      'recordRunning',
      'recordSuccess',
      'recordFailure',
      'recordPaused',
      'listForRun',
      'listStuckRunning',
      'getById',
    ]);
  });
});
