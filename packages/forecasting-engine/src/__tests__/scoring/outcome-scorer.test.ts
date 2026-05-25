import { describe, it, expect } from 'vitest';
import {
  scoreOutcome,
  rankByObjective,
} from '../../scoring/outcome-scorer.js';
import { paretoFrontier } from '../../scoring/pareto-frontier.js';
import { defaultIntentFor } from '../../world-model/business-archetype.js';
import type { ScenarioOutcome } from '../../types.js';

function mkOutcome(name: string, opts: Partial<ScenarioOutcome>): ScenarioOutcome {
  return {
    scenarioName: name,
    projectedNoi: [
      { t: 0, p10: 0, p50: 50_000, p90: 100_000 },
      { t: 1, p10: 0, p50: 50_000, p90: 100_000 },
    ],
    retentionProbability: 0.8,
    complianceScore: 0.9,
    intentAlignment: 0.7,
    cashShortfallProbability: 0.1,
    notes: [],
    ...opts,
  };
}

describe('outcome-scorer', () => {
  it('is deterministic for known inputs', () => {
    const intent = defaultIntentFor('cashflow-first');
    const o = mkOutcome('a', {});
    const s1 = scoreOutcome(o, intent);
    const s2 = scoreOutcome(o, intent);
    expect(s1.score).toBe(s2.score);
  });

  it('ranks higher-cashflow outcome first under cashflow-first intent', () => {
    const intent = defaultIntentFor('cashflow-first');
    const a = mkOutcome('high-cash', {
      projectedNoi: [
        { t: 0, p10: 0, p50: 250_000, p90: 500_000 },
        { t: 1, p10: 0, p50: 250_000, p90: 500_000 },
      ],
      retentionProbability: 0.5,
    });
    const b = mkOutcome('high-retention', {
      projectedNoi: [
        { t: 0, p10: 0, p50: 10_000, p90: 20_000 },
        { t: 1, p10: 0, p50: 10_000, p90: 20_000 },
      ],
      retentionProbability: 0.99,
    });
    const ranked = rankByObjective([
      scoreOutcome(a, intent),
      scoreOutcome(b, intent),
    ]);
    expect(ranked[0]?.scenarioName).toBe('high-cash');
  });

  it('shortfall risk penalises score', () => {
    const intent = defaultIntentFor('cashflow-first');
    const safe = scoreOutcome(mkOutcome('safe', { cashShortfallProbability: 0 }), intent);
    const risky = scoreOutcome(mkOutcome('risky', { cashShortfallProbability: 0.8 }), intent);
    expect(safe.score).toBeGreaterThan(risky.score);
  });
});

describe('paretoFrontier', () => {
  it('keeps non-dominated outcomes', () => {
    const intent = defaultIntentFor('cashflow-first');
    const a = scoreOutcome(
      mkOutcome('a', { retentionProbability: 0.9, complianceScore: 0.5 }),
      intent,
    );
    const b = scoreOutcome(
      mkOutcome('b', { retentionProbability: 0.5, complianceScore: 0.9 }),
      intent,
    );
    const c = scoreOutcome(
      mkOutcome('c', { retentionProbability: 0.4, complianceScore: 0.4 }),
      intent,
    );
    const front = paretoFrontier([a, b, c]);
    const names = front.map((x) => x.scenarioName).sort();
    expect(names).toEqual(['a', 'b']);
  });
});
