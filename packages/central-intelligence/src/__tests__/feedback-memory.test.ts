/**
 * Online-learning feedback wiring tests.
 *
 * Mounts the kernel through `composeSovereign` with a stub sensor and
 * a hand-rolled FeedbackMemoryPort, then asserts:
 *
 *   1. Recent corrections are mixed verbatim into the system prompt
 *      ("What I've learned from your feedback:")
 *   2. A high negative-rate (> 0.25) appends the conservative
 *      directive about citing every numerical claim
 *   3. An empty feedback recall produces NO fragment in the system
 *      prompt (the brain stays clean when there's nothing to learn)
 *   4. A throwing `feedback.recallRecent` does NOT break the turn —
 *      the kernel still returns a decision and the system prompt
 *      simply omits the fragment
 */

import { describe, it, expect } from 'vitest';
import {
  composeSovereign,
  type FeedbackEntry,
  type FeedbackMemoryPort,
  type ScopeContext,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
} from '../kernel/index.js';

const SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_demo',
  actorUserId: 'u_alice',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function captureSensor(): {
  sensor: Sensor;
  systems: string[];
} {
  const systems: string[] = [];
  const sensor: Sensor = {
    id: 'capture',
    modelId: 'capture-1',
    priority: 1,
    capabilities: ['fast'],
    async call(args: SensorCallArgs): Promise<SensorCallResult> {
      systems.push(args.system);
      return {
        text: 'ack',
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'capture-1',
        sensorId: 'capture',
      };
    },
  };
  return { sensor, systems };
}

function feedbackPort(
  entries: ReadonlyArray<FeedbackEntry>,
  opts?: { fail?: boolean },
): FeedbackMemoryPort {
  return {
    async recallRecent() {
      if (opts?.fail) throw new Error('feedback-down');
      return entries;
    },
  };
}

function entry(over: Partial<FeedbackEntry>): FeedbackEntry {
  return {
    id: 'fb_' + Math.random().toString(36).slice(2),
    tenantId: 't_demo',
    userId: 'u_alice',
    thoughtId: 'th_x',
    threadId: 't1',
    signal: 'thumbs-up',
    capturedAt: '2026-05-06T00:00:00.000Z',
    ...over,
  };
}

describe('feedback-memory wiring', () => {
  it('mixes recent corrections verbatim into the system prompt', async () => {
    const { sensor, systems } = captureSensor();
    const feedback = feedbackPort([
      entry({
        signal: 'correction',
        category: 'hallucinated',
        correctionText: 'You cited unit U-12 but that unit does not exist.',
      }),
      entry({
        signal: 'correction',
        category: 'hallucinated',
        correctionText: 'The arrears figure was off by 50,000 TZS.',
      }),
      entry({ signal: 'thumbs-up' }),
    ]);
    const sov = composeSovereign({ extraSensors: [sensor], feedback });

    await sov.kernel.think({
      threadId: 't1',
      userMessage: 'good morning',
      scope: SCOPE,
      tier: 'tenant',
      stakes: 'low',
      surface: 'estate-manager-app',
    });

    expect(systems[0]).toContain("What I've learned from your feedback:");
    expect(systems[0]).toContain('Recent corrections you gave me:');
    expect(systems[0]).toContain('unit U-12 but that unit does not exist');
    expect(systems[0]).toContain('arrears figure was off by 50,000 TZS');
  });

  it('appends the conservative directive when negativeRate > 0.25', async () => {
    const { sensor, systems } = captureSensor();
    // 4 negatives out of 5 total → negativeRate = 0.8 (well over 0.25)
    const feedback = feedbackPort([
      entry({ signal: 'thumbs-down', category: 'hallucinated' }),
      entry({ signal: 'thumbs-down', category: 'hallucinated' }),
      entry({
        signal: 'correction',
        category: 'hallucinated',
        correctionText: 'Numbers were wrong again.',
      }),
      entry({ signal: 'correction', category: 'unhelpful', correctionText: 'Not useful.' }),
      entry({ signal: 'thumbs-up' }),
    ]);
    const sov = composeSovereign({ extraSensors: [sensor], feedback });

    await sov.kernel.think({
      threadId: 't1',
      userMessage: 'help me with the rent roll',
      scope: SCOPE,
      tier: 'tenant',
      stakes: 'low',
      surface: 'estate-manager-app',
    });

    expect(systems[0]).toContain('higher-than-usual rate of negative feedback');
    expect(systems[0]).toContain('cite every numerical claim');
    expect(systems[0]).toContain('ask clarifying questions when uncertain');
  });

  it('emits NO feedback fragment when there is no recent feedback', async () => {
    const { sensor, systems } = captureSensor();
    const feedback = feedbackPort([]);
    const sov = composeSovereign({ extraSensors: [sensor], feedback });

    await sov.kernel.think({
      threadId: 't1',
      userMessage: 'good morning',
      scope: SCOPE,
      tier: 'tenant',
      stakes: 'low',
      surface: 'estate-manager-app',
    });

    expect(systems[0]).not.toContain("What I've learned from your feedback:");
    expect(systems[0]).not.toContain('higher-than-usual rate');
  });

  it('survives a throwing feedback.recallRecent without breaking the turn', async () => {
    const { sensor, systems } = captureSensor();
    const feedback = feedbackPort([], { fail: true });
    const sov = composeSovereign({ extraSensors: [sensor], feedback });

    const decision = await sov.kernel.think({
      threadId: 't1',
      userMessage: 'good morning',
      scope: SCOPE,
      tier: 'tenant',
      stakes: 'low',
      surface: 'estate-manager-app',
    });

    expect(decision.kind).toBe('answer');
    expect(systems).toHaveLength(1);
    expect(systems[0]).not.toContain("What I've learned from your feedback:");
  });
});
