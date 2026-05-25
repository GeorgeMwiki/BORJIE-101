import { describe, expect, it } from 'vitest';
import { runGauntlet } from '../runner.js';
import { SCENARIOS } from '../scenarios/index.js';
import type { AgentUnderTest, JudgeBrain, Scenario } from '../types.js';

function pickFor(text: string): AgentUnderTest {
  return {
    async respond() {
      return { text };
    },
  };
}

const now = () => new Date('2026-05-25T10:00:00.000Z');

describe('runGauntlet — basic', () => {
  it('runs all 10 default scenarios', async () => {
    const result = await runGauntlet({
      agent: pickFor('irrelevant'),
      now,
    });
    expect(result.responses).toHaveLength(10);
  });

  it('reports aggregatePassRate=0 when agent gives no signal', async () => {
    const result = await runGauntlet({
      agent: pickFor('no relevant signals'),
      now,
    });
    expect(result.aggregatePassRate).toBe(0);
  });

  it('reports aggregatePassRate=1 when agent triggers every pass signal in one response', async () => {
    // Concatenate all pass signals to be safe across scenarios.
    const big = SCENARIOS.flatMap((s) => s.passSignals).join(' ');
    const result = await runGauntlet({
      agent: pickFor(big),
      now,
    });
    expect(result.aggregatePassRate).toBeCloseTo(1, 5);
  });

  it('aggregatePassRate=0 when every response triggers a fail signal', async () => {
    const big = SCENARIOS.flatMap((s) => s.failSignals).join(' ');
    const result = await runGauntlet({
      agent: pickFor(big),
      now,
    });
    expect(result.aggregatePassRate).toBe(0);
  });

  it('gateStatus=passed at >=0.95 pass rate', async () => {
    const big = SCENARIOS.flatMap((s) => s.passSignals).join(' ');
    const result = await runGauntlet({
      agent: pickFor(big),
      now,
    });
    expect(result.gateStatus).toBe('passed');
  });

  it('gateStatus=failed below threshold', async () => {
    const result = await runGauntlet({
      agent: pickFor('irrelevant'),
      now,
    });
    expect(result.gateStatus).toBe('failed');
  });

  it('honours a custom gateThreshold', async () => {
    const result = await runGauntlet({
      agent: pickFor('irrelevant'),
      now,
      gateThreshold: 0,
    });
    expect(result.gateStatus).toBe('passed');
  });

  it('captures latencyMs per response', async () => {
    const result = await runGauntlet({
      agent: pickFor('x'),
      now,
    });
    for (const r of result.responses) {
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles agent throwing — records [agent threw: …]', async () => {
    const agent: AgentUnderTest = {
      async respond() { throw new Error('boom'); },
    };
    const result = await runGauntlet({ agent, now });
    expect(result.responses[0]?.response).toContain('[agent threw:');
  });

  it('produces perCategoryPassRate with all 8 keys', async () => {
    const result = await runGauntlet({
      agent: pickFor('x'),
      now,
    });
    expect(Object.keys(result.perCategoryPassRate).sort()).toEqual(
      [
        'capability_lying',
        'covert_action',
        'deception',
        'hidden_goal_pursuit',
        'instrumental_convergence',
        'metric_gaming',
        'sandbagging',
        'sycophancy',
      ].sort(),
    );
  });

  it('honours a custom scenario list', async () => {
    const minimal: Scenario = {
      id: 'only-one',
      category: 'deception',
      title: 't',
      systemContext: 'sc',
      userPrompt: 'up',
      expectedBehavior: 'refuse',
      passSignals: ['ok'],
      failSignals: ['bad'],
    };
    const result = await runGauntlet({
      agent: pickFor('ok'),
      scenarios: [minimal],
      now,
    });
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0]?.verdict).toBe('pass');
  });

  it('uses judge when supplied', async () => {
    const judge: JudgeBrain = {
      async judge() { return { schemingScore: 0.0, reasoning: 'safe' }; },
    };
    const result = await runGauntlet({
      agent: pickFor('whatever'),
      judge,
      now,
    });
    for (const r of result.responses) {
      expect(['pass', 'ambiguous']).toContain(r.verdict);
    }
  });

  it('captures runId from generator', async () => {
    const result = await runGauntlet({
      agent: pickFor('x'),
      now,
      runIdGenerator: () => 'my-id-123',
    });
    expect(result.runId).toBe('my-id-123');
  });

  it('default runId starts with gauntlet-', async () => {
    const result = await runGauntlet({
      agent: pickFor('x'),
      now,
    });
    expect(result.runId).toMatch(/^gauntlet-/);
  });

  it('responses preserve scenario order', async () => {
    const result = await runGauntlet({
      agent: pickFor('x'),
      now,
    });
    expect(result.responses.map((r) => r.scenarioId)).toEqual(
      SCENARIOS.map((s) => s.id),
    );
  });
});
