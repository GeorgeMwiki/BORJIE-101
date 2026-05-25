import { describe, it, expect } from 'vitest';
import {
  InMemoryProcessObservationStore,
  buildObservation,
  createProcessMiner,
  listSubscribedEventTypes,
  subscribeOrgEvents,
} from '../index.js';

describe('event-subscribers', () => {
  it('builds a ProcessObservationInput from a maintenance lifecycle event', () => {
    const obs = buildObservation({
      eventType: 'maintenance.case.triaged',
      tenantId: 't1',
      timestamp: '2026-04-01T00:00:00Z',
      payload: {
        caseId: 'case-1',
        actorKind: 'human',
        actorId: 'user-1',
        previousStage: 'reported',
        durationMsFromPrevious: 4000,
      },
    });
    expect(obs).not.toBeNull();
    expect(obs?.processKind).toBe('maintenance_case');
    expect(obs?.stage).toBe('triaged');
    expect(obs?.processInstanceId).toBe('case-1');
    expect(obs?.durationMsFromPrevious).toBe(4000);
  });

  it('marks maintenance.case.reopened as reopen', () => {
    const obs = buildObservation({
      eventType: 'maintenance.case.reopened',
      tenantId: 't1',
      payload: { caseId: 'case-1', actorKind: 'tenant' },
    });
    expect(obs?.isReopen).toBe(true);
  });

  it('returns null for unknown event types', () => {
    expect(
      buildObservation({
        eventType: 'unknown.event',
        tenantId: 't1',
        payload: {},
      }),
    ).toBeNull();
  });

  it('lists all subscribed event types', () => {
    const types = listSubscribedEventTypes();
    expect(types).toContain('maintenance.case.triaged');
    expect(types).toContain('payment.reconciled');
    expect(types).toContain('training.completed');
  });

  it('subscribes handlers to a bus and routes events into the miner', async () => {
    const store = new InMemoryProcessObservationStore();
    const miner = createProcessMiner({ store });
    const handlers = new Map<string, (e: unknown) => void>();
    const bus = {
      subscribe(type: string, handler: (e: unknown) => void) {
        handlers.set(type, handler);
        return () => handlers.delete(type);
      },
    };
    const unsub = subscribeOrgEvents({ bus, miner });
    const handler = handlers.get('maintenance.case.assigned');
    expect(handler).toBeDefined();
    await handler?.({
      eventType: 'maintenance.case.assigned',
      tenantId: 't1',
      payload: {
        caseId: 'case-42',
        actorKind: 'human',
      },
    });
    const obs = await store.list('t1', 'maintenance_case');
    expect(obs).toHaveLength(1);
    expect(obs[0].stage).toBe('assigned');
    unsub();
    expect(handlers.size).toBe(0);
  });
});
