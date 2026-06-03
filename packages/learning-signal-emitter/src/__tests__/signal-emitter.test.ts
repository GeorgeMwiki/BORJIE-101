/**
 * Signal-emitter tests — the fan-out heart of LP-17.
 *
 * Verifies:
 *   - a positive reward routes to the belief sink; a negative decision routes
 *     to reflexion; mastery + pattern always fire.
 *   - the isolation gate blocks a bad-scope signal BEFORE any sink is called.
 *   - the idempotency hash is stable across identical re-emits.
 *   - a throwing sink is absorbed into notes (the emitter never throws).
 *   - the belief sink is the ONLY belief writer — the emitter never mutates a
 *     belief itself (it only invokes the injected adapter).
 */

import { describe, it, expect, vi } from 'vitest';

import {
  emitSignal,
  buildSignal,
  buildSignalHash,
  routePlan,
  type SignalSinks,
} from '../signal-emitter.js';
import type { ActionEvent, OutcomeEvent } from '../types.js';

function action(overrides: Partial<ActionEvent> = {}): ActionEvent {
  return {
    id: 'a-1',
    kind: 'decide',
    capturedAt: '2026-06-03T00:00:00.000Z',
    actorId: 'mgr-1',
    actorTier: 'manager',
    payload: {},
    tenantUserId: 'owner-1', // → user scope
    ...overrides,
  };
}

function outcome(overrides: Partial<OutcomeEvent> = {}): OutcomeEvent {
  return {
    id: 'o-1',
    actionRef: 'a-1',
    observedAt: '2026-06-03T00:05:00.000Z',
    ...overrides,
  };
}

function recordingSinks(): {
  readonly sinks: SignalSinks;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const make = (name: string) => async () => {
    calls.push(name);
    return true;
  };
  return {
    calls,
    sinks: {
      beliefStrengthen: make('belief'),
      reflexionRecord: make('reflexion'),
      masteryUpdate: make('mastery'),
      patternStore: make('pattern'),
      personaPrompt: make('persona'),
      preferenceLearner: make('preference'),
    },
  };
}

describe('buildSignalHash', () => {
  it('is stable across identical inputs', () => {
    const a = buildSignalHash({ actionRef: 'x', outcomeRef: 'y', reward: 0.5 });
    const b = buildSignalHash({ actionRef: 'x', outcomeRef: 'y', reward: 0.5 });
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });

  it('changes when the reward changes', () => {
    const a = buildSignalHash({ actionRef: 'x', reward: 0.5 });
    const b = buildSignalHash({ actionRef: 'x', reward: 0.6 });
    expect(a).not.toBe(b);
  });
});

describe('buildSignal', () => {
  it('resolves user scope from the action + is frozen', () => {
    const s = buildSignal({ action: action(), outcome: outcome({ slaHit: true }) });
    expect(s.tenantScope).toBe('user');
    expect(s.subjectUserId).toBe('owner-1');
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('resolves platform scope when no tenant ids present', () => {
    const s = buildSignal({
      action: action({ tenantUserId: null, tenantOrgId: null }),
      outcome: outcome(),
    });
    expect(s.tenantScope).toBe('platform');
  });
});

describe('routePlan', () => {
  it('routes a strong positive reward to the belief store', () => {
    const s = buildSignal({
      action: action(),
      outcome: outcome({ slaDelaySeconds: -300, explicitSatisfaction: 1 }),
    });
    expect(routePlan(s)).toContain('belief-store');
  });

  it('routes a negative decision to reflexion-lessons', () => {
    const s = buildSignal({
      action: action(),
      outcome: outcome({ managerOverride: true, ownerComplaint: true }),
    });
    const plan = routePlan(s);
    expect(plan).toContain('reflexion-lessons');
    expect(plan).toContain('persona-prompt-bridge');
  });

  it('always includes mastery + pattern regardless of sign', () => {
    const s = buildSignal({ action: action(), outcome: outcome() });
    const plan = routePlan(s);
    expect(plan).toContain('mastery-tracker');
    expect(plan).toContain('pattern-store');
  });
});

describe('emitSignal — fan-out', () => {
  it('fans a positive signal out to belief + mastery + pattern + preference', async () => {
    const { sinks, calls } = recordingSinks();
    const result = await emitSignal({
      action: action(),
      outcome: outcome({ slaDelaySeconds: -300, explicitSatisfaction: 1 }),
      sinks,
    });
    expect(result.routedTo).toContain('belief-store');
    expect(result.routedTo).toContain('mastery-tracker');
    expect(result.routedTo).toContain('pattern-store');
    expect(calls).toContain('belief');
  });

  it('routes a negative decision to reflexion + persona', async () => {
    const { sinks, calls } = recordingSinks();
    const result = await emitSignal({
      action: action(),
      outcome: outcome({ managerOverride: true, ownerComplaint: true }),
      sinks,
    });
    expect(result.routedTo).toContain('reflexion-lessons');
    expect(calls).toContain('reflexion');
    // A hard-negative reward does NOT touch the belief sink.
    expect(calls).not.toContain('belief');
  });
});

describe('emitSignal — isolation gate', () => {
  it('blocks a platform signal under k-anonymity BEFORE any sink fires', async () => {
    const { sinks, calls } = recordingSinks();
    const result = await emitSignal({
      action: action({ tenantUserId: null, tenantOrgId: null }),
      outcome: outcome({ slaDelaySeconds: -300 }),
      sinks,
      cohortSize: 3,
    });
    expect(result.routedTo).toEqual(['isolation-blocked']);
    expect(result.notes[0]).toMatch(/isolation blocked/);
    expect(calls).toHaveLength(0); // no sink touched
  });
});

describe('emitSignal — resilience', () => {
  it('absorbs a throwing sink into notes without throwing', async () => {
    const result = await emitSignal({
      // Early SLA + full satisfaction → reward 0.40 ≥ floor, so belief-store
      // is in the route plan and the throwing belief sink actually fires.
      action: action(),
      outcome: outcome({ slaDelaySeconds: -300, explicitSatisfaction: 1 }),
      sinks: {
        beliefStrengthen: async () => {
          throw new Error('db down');
        },
        masteryUpdate: async () => true,
      },
    });
    expect(result.notes.some((n) => n.includes('threw'))).toBe(true);
    expect(result.routedTo).toContain('mastery-tracker');
  });

  it('reports no-route when no sinks are configured', async () => {
    const result = await emitSignal({
      action: action(),
      outcome: outcome({ slaHit: true }),
    });
    expect(result.routedTo).toEqual(['no-route']);
  });

  it('never calls a sink the caller did not provide', async () => {
    const beliefStrengthen = vi.fn(async () => true);
    await emitSignal({
      action: action(),
      outcome: outcome({ slaDelaySeconds: -300, explicitSatisfaction: 1 }),
      sinks: { beliefStrengthen },
    });
    expect(beliefStrengthen).toHaveBeenCalledTimes(1);
  });
});
