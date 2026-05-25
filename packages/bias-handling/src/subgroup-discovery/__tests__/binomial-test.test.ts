import { describe, expect, it } from 'vitest';
import { twoSidedBinomialPValue } from '../binomial-test.js';

describe('twoSidedBinomialPValue', () => {
  it('returns 1.0 for small n', () => {
    expect(
      twoSidedBinomialPValue({ observedFailures: 5, n: 5, baselineRate: 0.1 }),
    ).toBe(1.0);
  });

  it('returns ~1.0 when observed matches baseline exactly', () => {
    const p = twoSidedBinomialPValue({
      observedFailures: 10,
      n: 100,
      baselineRate: 0.1,
    });
    expect(p).toBeCloseTo(1.0, 2);
  });

  it('returns small p when observed differs sharply from baseline', () => {
    // 80/100 failures at baseline rate 0.1 — extreme.
    const p = twoSidedBinomialPValue({
      observedFailures: 80,
      n: 100,
      baselineRate: 0.1,
    });
    expect(p).toBeLessThan(0.001);
  });

  it('returns 1.0 for degenerate baseline rates 0 or 1', () => {
    expect(
      twoSidedBinomialPValue({ observedFailures: 5, n: 100, baselineRate: 0 }),
    ).toBe(1.0);
    expect(
      twoSidedBinomialPValue({ observedFailures: 5, n: 100, baselineRate: 1 }),
    ).toBe(1.0);
  });
});
