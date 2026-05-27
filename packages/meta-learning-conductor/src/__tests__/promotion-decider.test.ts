import { describe, expect, it } from 'vitest';
import { decidePromotion } from '../decider/promotion-decider.js';

describe('decidePromotion', () => {
  it('promotes when delta exceeds threshold', () => {
    const out = decidePromotion({
      evalMetricBefore: 0.6,
      evalMetricAfter: 0.7,
      previousDecision: null,
    });
    expect(out.decision).toBe('promote');
    expect(out.delta).toBeCloseTo(0.1, 6);
  });

  it('demotes when delta is below negative threshold', () => {
    const out = decidePromotion({
      evalMetricBefore: 0.7,
      evalMetricAfter: 0.55,
      previousDecision: null,
    });
    expect(out.decision).toBe('demote');
  });

  it('rolls back when previous was promote and we regress', () => {
    const out = decidePromotion({
      evalMetricBefore: 0.7,
      evalMetricAfter: 0.6,
      previousDecision: 'promote',
    });
    expect(out.decision).toBe('rollback');
    expect(out.reason).toMatch(/previous promote regressed/);
  });

  it('no-ops when delta is within bounds', () => {
    const out = decidePromotion({
      evalMetricBefore: 0.7,
      evalMetricAfter: 0.71,
      previousDecision: null,
    });
    expect(out.decision).toBe('no-op');
  });

  it('respects custom thresholds', () => {
    const out = decidePromotion({
      evalMetricBefore: 0.6,
      evalMetricAfter: 0.7,
      previousDecision: null,
      config: { promoteThreshold: 0.2, demoteThreshold: 0.2 },
    });
    expect(out.decision).toBe('no-op');
  });
});
