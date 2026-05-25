import { describe, expect, it } from 'vitest';
import {
  createObservationLoop,
  reflectOnPeriod,
} from '../observation-loop/index.js';
import { makeFakeBrain } from './test-helpers.js';
import type { Observation } from '../types.js';
import { nowIso } from '../types.js';

function makeObs(overrides: Partial<Observation> = {}): Observation {
  return {
    id: overrides.id ?? `obs-${Math.random().toString(36).slice(2, 10)}`,
    kind: overrides.kind ?? 'capability-result',
    tenantId: overrides.tenantId ?? 't-1',
    agentId: overrides.agentId ?? 'agent-a',
    detail: overrides.detail ?? 'detail',
    at: overrides.at ?? nowIso(),
    ...(overrides.goalId ? { goalId: overrides.goalId } : {}),
    ...(overrides.subGoalId ? { subGoalId: overrides.subGoalId } : {}),
    ...(overrides.outcome ? { outcome: overrides.outcome } : {}),
  };
}

describe('observation-loop / emit + list', () => {
  it('stores observations and filters by agent', async () => {
    const loop = createObservationLoop();
    await loop.emit(makeObs({ agentId: 'a' }));
    await loop.emit(makeObs({ agentId: 'b' }));
    const aObs = await loop.list({ agentId: 'a' });
    expect(aObs.length).toBe(1);
    expect(aObs[0]?.agentId).toBe('a');
  });

  it('filters by tenantId, goalId, and time window', async () => {
    const loop = createObservationLoop();
    await loop.emit(
      makeObs({
        tenantId: 't-1',
        goalId: 'g-1',
        at: '2026-05-01T00:00:00Z',
      }),
    );
    await loop.emit(
      makeObs({
        tenantId: 't-2',
        goalId: 'g-2',
        at: '2026-05-20T00:00:00Z',
      }),
    );
    const filtered = await loop.list({
      tenantId: 't-1',
      goalId: 'g-1',
      sinceIso: '2026-04-01T00:00:00Z',
      untilIso: '2026-05-10T00:00:00Z',
    });
    expect(filtered.length).toBe(1);
  });
});

describe('observation-loop / subscribeAgent', () => {
  it('delivers matching observations to the subscriber', async () => {
    const loop = createObservationLoop();
    const received: Observation[] = [];
    loop.subscribeAgent({
      agentId: 'agent-a',
      handler: (o) => {
        received.push(o);
      },
    });
    await loop.emit(makeObs({ agentId: 'agent-a' }));
    await loop.emit(makeObs({ agentId: 'agent-b' }));
    await loop.emit(makeObs({ agentId: 'agent-a' }));
    expect(received.length).toBe(2);
  });

  it('stops delivering after unsubscribe', async () => {
    const loop = createObservationLoop();
    const received: Observation[] = [];
    const sub = loop.subscribeAgent({
      agentId: 'agent-a',
      handler: (o) => {
        received.push(o);
      },
    });
    await loop.emit(makeObs({ agentId: 'agent-a' }));
    sub.unsubscribe();
    await loop.emit(makeObs({ agentId: 'agent-a' }));
    expect(received.length).toBe(1);
  });

  it('does not crash when a handler throws', async () => {
    const loop = createObservationLoop();
    loop.subscribeAgent({
      agentId: 'agent-a',
      handler: () => {
        throw new Error('boom');
      },
    });
    await expect(loop.emit(makeObs({ agentId: 'agent-a' }))).resolves.toBeUndefined();
  });

  it('notifies global subscribers for every observation', async () => {
    const loop = createObservationLoop();
    const received: Observation[] = [];
    loop.subscribeAll((o) => {
      received.push(o);
    });
    await loop.emit(makeObs({ agentId: 'agent-a' }));
    await loop.emit(makeObs({ agentId: 'agent-b' }));
    expect(received.length).toBe(2);
  });
});

describe('observation-loop / reflectOnPeriod', () => {
  it('calls brain.reflect with the observations in window', async () => {
    const loop = createObservationLoop();
    await loop.emit(makeObs({ agentId: 'agent-a', at: '2026-05-20T00:00:00Z' }));
    await loop.emit(makeObs({ agentId: 'agent-a', at: '2026-05-21T00:00:00Z' }));
    const update = await reflectOnPeriod({
      agentId: 'agent-a',
      observations: loop,
      brain: makeFakeBrain(),
      sinceIso: '2026-05-19T00:00:00Z',
      untilIso: '2026-05-22T00:00:00Z',
    });
    expect(update.agentId).toBe('agent-a');
    expect(update.observationCount).toBe(2);
    expect(update.summary).toContain('2');
  });

  it('returns an empty reflection when window has no observations', async () => {
    const loop = createObservationLoop();
    const update = await reflectOnPeriod({
      agentId: 'agent-a',
      observations: loop,
      brain: makeFakeBrain(),
      sinceIso: '2026-05-19T00:00:00Z',
      untilIso: '2026-05-22T00:00:00Z',
    });
    expect(update.observationCount).toBe(0);
  });
});
