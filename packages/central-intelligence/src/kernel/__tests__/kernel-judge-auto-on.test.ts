/**
 * Brain kernel — judge auto-on for stakes >= 'high'.
 *
 * Phase D D2 — agency-grade reasoning hygiene.
 *
 * Pinned behaviours (one-line change at kernel.ts:~913):
 *   - stakes === 'high'    triggers the judge automatically
 *   - stakes === 'critical' triggers the judge (unchanged from before)
 *   - stakes === 'low' or 'medium' does NOT trigger the judge
 *   - requireJudge: false + stakes === 'high' STILL triggers
 *     (high stakes overrides an explicit opt-out)
 *   - requireJudge: true  + stakes === 'medium' triggers (opt-in path)
 *   - requireJudge: true  + stakes === 'low'    triggers
 */

import { describe, it, expect } from 'vitest';
import {
  createBrainKernel,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
  type ThoughtRequest,
} from '../index.js';
import type { ScopeContext } from '../../types.js';

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_demo',
  actorUserId: 'u_demo',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function scriptedSensor(
  id: string,
  text: string,
): Sensor {
  return {
    id,
    modelId: `${id}-model`,
    priority: 10,
    capabilities: ['thinking', 'fast'],
    async call(_args: SensorCallArgs): Promise<SensorCallResult> {
      return {
        text,
        thought: null,
        toolCalls: [],
        latencyMs: 5,
        modelId: `${id}-model`,
        sensorId: id,
      };
    },
  };
}

function makeRequest(over: Partial<ThoughtRequest>): ThoughtRequest {
  return {
    threadId: `thread-${Math.random().toString(36).slice(2, 9)}`,
    userMessage: 'How is collection looking this month?',
    scope: TENANT_SCOPE,
    tier: 'property',
    stakes: 'medium',
    surface: 'estate-manager-app',
    ...over,
  };
}

function makeJudge() {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async judge(text: string) {
      calls += 1;
      // High score → no regen path triggered (we only assert judge-was-called).
      return { score: 0.95, reasonText: 'looks good', suggestedFix: '' };
    },
  };
}

describe('brain kernel — judge auto-on (Phase D D2)', () => {
  it('triggers the judge when stakes === high', async () => {
    const sensor = scriptedSensor('claude-opus', 'The collection is strong this month.');
    const judge = makeJudge();
    const kernel = createBrainKernel({ sensors: [sensor], judge: judge.judge });
    await kernel.think(makeRequest({ stakes: 'high' }));
    expect(judge.calls).toBe(1);
  });

  it('triggers the judge when stakes === critical (unchanged)', async () => {
    const sensor = scriptedSensor('claude-opus', 'Critical answer drafted.');
    const judge = makeJudge();
    const kernel = createBrainKernel({ sensors: [sensor], judge: judge.judge });
    await kernel.think(makeRequest({ stakes: 'critical' }));
    expect(judge.calls).toBe(1);
  });

  it('does NOT trigger the judge when stakes === low', async () => {
    const sensor = scriptedSensor('claude-opus', 'Low-stakes answer.');
    const judge = makeJudge();
    const kernel = createBrainKernel({ sensors: [sensor], judge: judge.judge });
    await kernel.think(makeRequest({ stakes: 'low' }));
    expect(judge.calls).toBe(0);
  });

  it('does NOT trigger the judge when stakes === medium', async () => {
    const sensor = scriptedSensor('claude-opus', 'Medium-stakes answer.');
    const judge = makeJudge();
    const kernel = createBrainKernel({ sensors: [sensor], judge: judge.judge });
    await kernel.think(makeRequest({ stakes: 'medium' }));
    expect(judge.calls).toBe(0);
  });

  it('still triggers the judge when requireJudge=false + stakes=high (high overrides)', async () => {
    const sensor = scriptedSensor('claude-opus', 'High-stakes answer.');
    const judge = makeJudge();
    const kernel = createBrainKernel({ sensors: [sensor], judge: judge.judge });
    await kernel.think(
      makeRequest({ stakes: 'high', requireJudge: false }),
    );
    expect(judge.calls).toBe(1);
  });

  it('triggers the judge when requireJudge=true + stakes=medium (opt-in path)', async () => {
    const sensor = scriptedSensor('claude-opus', 'Opt-in judge.');
    const judge = makeJudge();
    const kernel = createBrainKernel({ sensors: [sensor], judge: judge.judge });
    await kernel.think(
      makeRequest({ stakes: 'medium', requireJudge: true }),
    );
    expect(judge.calls).toBe(1);
  });

  it('triggers the judge when requireJudge=true + stakes=low (opt-in path)', async () => {
    const sensor = scriptedSensor('claude-opus', 'Opt-in low-stakes judge.');
    const judge = makeJudge();
    const kernel = createBrainKernel({ sensors: [sensor], judge: judge.judge });
    await kernel.think(
      makeRequest({ stakes: 'low', requireJudge: true }),
    );
    expect(judge.calls).toBe(1);
  });
});
