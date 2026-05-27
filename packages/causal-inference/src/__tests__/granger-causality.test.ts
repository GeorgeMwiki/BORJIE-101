import { describe, expect, it } from 'vitest';
import {
  fDistributionUpperTail,
  grangerCausality,
} from '../discovery/granger-causality.js';
import { CausalInferenceError } from '../types.js';
import { mulberry32 } from '../refute/prng.js';

function generateSyntheticCausalSeries(
  n: number,
  seed: number,
  coupling: number,
): { x: number[]; y: number[] } {
  const rng = mulberry32(seed);
  const x: number[] = new Array(n).fill(0);
  const y: number[] = new Array(n).fill(0);
  x[0] = rng() - 0.5;
  y[0] = rng() - 0.5;
  for (let t = 1; t < n; t += 1) {
    x[t] = 0.3 * (x[t - 1] as number) + (rng() - 0.5);
    y[t] =
      coupling * (x[t - 1] as number) +
      0.2 * (y[t - 1] as number) +
      (rng() - 0.5);
  }
  return { x, y };
}

describe('Granger causality test — synthetic series', () => {
  it('rejects H_0 when y(t) = 0.6 * x(t-1) + noise', () => {
    const { x, y } = generateSyntheticCausalSeries(300, 42, 0.6);
    const r = grangerCausality(x, y, { maxLag: 1, alpha: 0.05 });
    expect(r.causal).toBe(true);
    expect(r.pValue).toBeLessThan(0.05);
  });

  it('fails to reject H_0 when x is independent of y', () => {
    const { x, y } = generateSyntheticCausalSeries(300, 99, 0);
    const r = grangerCausality(x, y, { maxLag: 1, alpha: 0.05 });
    expect(r.pValue).toBeGreaterThan(0.05);
  });

  it('throws when series lengths differ', () => {
    expect(() => grangerCausality([1, 2, 3], [1, 2])).toThrow(
      CausalInferenceError,
    );
  });

  it('throws when sample size is too small for the lag', () => {
    expect(() => grangerCausality([1, 2, 3, 4], [4, 3, 2, 1], { maxLag: 5 })).toThrow(
      CausalInferenceError,
    );
  });

  it('reports degrees of freedom and sample size', () => {
    const { x, y } = generateSyntheticCausalSeries(100, 7, 0.5);
    const r = grangerCausality(x, y, { maxLag: 2 });
    expect(r.degreesOfFreedom.num).toBe(2);
    expect(r.degreesOfFreedom.den).toBeGreaterThan(0);
    expect(r.sampleSize).toBe(98);
  });
});

describe('F distribution upper-tail', () => {
  it('returns 1 at x = 0', () => {
    expect(fDistributionUpperTail(0, 5, 10)).toBeCloseTo(1, 5);
  });

  it('decreases monotonically with x', () => {
    const p1 = fDistributionUpperTail(1, 5, 10);
    const p5 = fDistributionUpperTail(5, 5, 10);
    const p20 = fDistributionUpperTail(20, 5, 10);
    expect(p5).toBeLessThan(p1);
    expect(p20).toBeLessThan(p5);
  });

  it('returns ~0.05 near the F(1, 50) 95th percentile (4.03)', () => {
    const p = fDistributionUpperTail(4.03, 1, 50);
    expect(p).toBeGreaterThan(0.04);
    expect(p).toBeLessThan(0.06);
  });
});
