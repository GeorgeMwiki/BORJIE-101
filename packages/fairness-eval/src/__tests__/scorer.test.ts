import { describe, expect, it, vi } from 'vitest';
import { aggregatePairs, scorePair } from '../scorer.js';
import type { BrainDecision, CounterfactualPair, FairnessBrain, ProtectedAttributeSpec } from '../types.js';

const spec: ProtectedAttributeSpec = {
  id: 'race',
  profileKey: 'race',
  values: ['a', 'b'],
  jurisdictions: ['US'],
  citation: 'FHA',
};

function pair(over: Partial<CounterfactualPair> = {}): CounterfactualPair {
  return {
    attribute: 'race',
    profileKey: 'race',
    originalValue: 'a',
    counterfactualValue: 'b',
    originalProfile: { race: 'a' },
    counterfactualProfile: { race: 'b' },
    ...over,
  };
}

function brainReturning(
  fnA: () => BrainDecision,
  fnB: () => BrainDecision,
): FairnessBrain {
  return {
    async decide(profile) {
      return profile.race === 'a' ? fnA() : fnB();
    },
  };
}

describe('scorePair', () => {
  it('flags violation on outcome divergence', async () => {
    const brain = brainReturning(
      () => ({ outcome: 'approve', score: 0.8, reasonCodes: [] }),
      () => ({ outcome: 'deny', score: 0.2, reasonCodes: [] }),
    );
    const out = await scorePair(brain, pair(), 0.05);
    expect(out.outcomeDiverges).toBe(true);
    expect(out.violatesFairness).toBe(true);
  });

  it('flags violation on score delta > tolerance', async () => {
    const brain = brainReturning(
      () => ({ outcome: 'approve', score: 0.8, reasonCodes: [] }),
      () => ({ outcome: 'approve', score: 0.5, reasonCodes: [] }),
    );
    const out = await scorePair(brain, pair(), 0.05);
    expect(out.outcomeDiverges).toBe(false);
    expect(out.scoreDelta).toBeCloseTo(0.3, 5);
    expect(out.violatesFairness).toBe(true);
  });

  it('passes when both outcomes + scores match within tolerance', async () => {
    const brain = brainReturning(
      () => ({ outcome: 'approve', score: 0.8, reasonCodes: ['ok'] }),
      () => ({ outcome: 'approve', score: 0.79, reasonCodes: ['ok'] }),
    );
    const out = await scorePair(brain, pair(), 0.05);
    expect(out.violatesFairness).toBe(false);
  });

  it('captures reason-code divergence', async () => {
    const brain = brainReturning(
      () => ({ outcome: 'approve', score: 0.8, reasonCodes: ['ok', 'good_dti'] }),
      () => ({ outcome: 'approve', score: 0.8, reasonCodes: ['ok', 'background_check'] }),
    );
    const out = await scorePair(brain, pair(), 0.05);
    expect(out.reasonCodesDiverge.sort()).toEqual(['background_check', 'good_dti']);
  });

  it('runs both decide calls in parallel', async () => {
    const brain = {
      decide: vi.fn(async () => ({
        outcome: 'approve' as const,
        score: 0.5,
        reasonCodes: [],
      })),
    };
    await scorePair(brain, pair(), 0.05);
    expect(brain.decide).toHaveBeenCalledTimes(2);
  });
});

describe('aggregatePairs', () => {
  it('computes violationRate', async () => {
    const brain = brainReturning(
      () => ({ outcome: 'approve', score: 0.8, reasonCodes: [] }),
      () => ({ outcome: 'deny', score: 0.2, reasonCodes: [] }),
    );
    const report = await aggregatePairs(
      brain,
      [pair(), pair({ counterfactualValue: 'c' })],
      spec,
      'US',
      0.05,
    );
    expect(report.violations).toBe(2);
    expect(report.violationRate).toBe(1);
  });

  it('reports zero violation when all clean', async () => {
    const brain = brainReturning(
      () => ({ outcome: 'approve', score: 0.5, reasonCodes: [] }),
      () => ({ outcome: 'approve', score: 0.5, reasonCodes: [] }),
    );
    const report = await aggregatePairs(brain, [pair()], spec, 'US', 0.05);
    expect(report.violations).toBe(0);
    expect(report.violationRate).toBe(0);
  });

  it('captures worstScoreDelta across pairs', async () => {
    let n = 0;
    const brain: FairnessBrain = {
      async decide(profile) {
        if (profile.race === 'a') return { outcome: 'approve', score: 0.9, reasonCodes: [] };
        n++;
        return { outcome: 'approve', score: n === 1 ? 0.85 : 0.5, reasonCodes: [] };
      },
    };
    const report = await aggregatePairs(
      brain,
      [pair(), pair({ counterfactualValue: 'c' })],
      spec,
      'US',
      0.5,
    );
    expect(report.worstScoreDelta).toBeCloseTo(0.4, 5);
  });

  it('returns zero pairs metadata for empty input', async () => {
    const brain = brainReturning(
      () => ({ outcome: 'approve', score: 0.5, reasonCodes: [] }),
      () => ({ outcome: 'approve', score: 0.5, reasonCodes: [] }),
    );
    const report = await aggregatePairs(brain, [], spec, 'US', 0.05);
    expect(report.pairsTested).toBe(0);
    expect(report.violationRate).toBe(0);
    expect(report.violations).toBe(0);
  });
});
