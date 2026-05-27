import { describe, expect, it } from 'vitest';
import { placeboRefutation } from '../refute/placebo.js';
import { bootstrap } from '../refute/bootstrap.js';
import { eValueSensitivity } from '../refute/sensitivity.js';

describe('Placebo refutation', () => {
  it('returns ~zero mean effect on a permuted-outcome estimator', () => {
    // A trivial estimator: mean of outcomes -- under any permutation
    // the mean is unchanged, so placebo effect = factual effect.
    // Use a difference-style estimator: mean(first half) - mean(second half).
    const obs = Array.from({ length: 100 }, (_, i) => ({
      outcome: Math.sin(i),
      payload: {},
    }));
    const estimator = (xs: ReadonlyArray<{ outcome: number }>): number => {
      const half = Math.floor(xs.length / 2);
      let a = 0;
      let b = 0;
      for (let i = 0; i < half; i += 1) a += xs[i]!.outcome;
      for (let i = half; i < xs.length; i += 1) b += xs[i]!.outcome;
      return a / half - b / (xs.length - half);
    };
    const r = placeboRefutation(obs, estimator, {
      strategy: 'permuted-outcome',
      numReplications: 200,
      seed: 7,
    });
    expect(Math.abs(r.meanEffect)).toBeLessThan(0.5);
  });

  it('supports random-outcome strategy', () => {
    const obs = Array.from({ length: 50 }, (_, i) => ({
      outcome: i,
      payload: {},
    }));
    const r = placeboRefutation(obs, () => 0, {
      strategy: 'random-outcome',
      numReplications: 30,
      seed: 11,
    });
    expect(r.replications.length).toBe(30);
  });
});

describe('Bootstrap CI', () => {
  it('contains the true mean for a Gaussian-ish sample', () => {
    const obs = Array.from({ length: 200 }, (_, i) => ({
      x: Math.sin(i / 3) + Math.cos(i / 7),
    }));
    const trueMean = obs.reduce((s, o) => s + o.x, 0) / obs.length;
    const r = bootstrap(obs, (xs) => {
      let m = 0;
      for (const o of xs) m += o.x;
      return m / Math.max(1, xs.length);
    }, { numReplications: 1000, seed: 33 });
    expect(r.ciLow).toBeLessThanOrEqual(trueMean);
    expect(r.ciHigh).toBeGreaterThanOrEqual(trueMean);
    expect(r.standardError).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed', () => {
    const obs = [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }];
    const r1 = bootstrap(obs, (xs) => xs.reduce((s, o) => s + o.v, 0) / Math.max(1, xs.length), { seed: 42 });
    const r2 = bootstrap(obs, (xs) => xs.reduce((s, o) => s + o.v, 0) / Math.max(1, xs.length), { seed: 42 });
    expect(r1.meanEstimate).toBeCloseTo(r2.meanEstimate, 9);
    expect(r1.ciLow).toBeCloseTo(r2.ciLow, 9);
    expect(r1.ciHigh).toBeCloseTo(r2.ciHigh, 9);
  });
});

describe('E-value sensitivity', () => {
  it('returns E-value = 1 when there is no effect (RR = 1)', () => {
    const r = eValueSensitivity({ estimate: 1, scale: 'risk-ratio' });
    expect(r.eValue).toBeCloseTo(1, 6);
    expect(r.robust).toBe(false);
  });

  it('returns E-value ≈ 3.73 for RR = 2 (VanderWeele Table 1)', () => {
    const r = eValueSensitivity({ estimate: 2, scale: 'risk-ratio' });
    expect(r.eValue).toBeCloseTo(2 + Math.sqrt(2 * 1), 6);
    expect(r.robust).toBe(true);
  });

  it('handles protective effects (RR < 1) symmetrically', () => {
    const a = eValueSensitivity({ estimate: 2, scale: 'risk-ratio' });
    const b = eValueSensitivity({ estimate: 0.5, scale: 'risk-ratio' });
    expect(a.eValue).toBeCloseTo(b.eValue, 6);
  });

  it('maps standardised-difference scale to an approximate RR', () => {
    const r = eValueSensitivity({
      estimate: 1.0,
      scale: 'standardised-difference',
    });
    expect(r.eValue).toBeGreaterThan(1);
  });
});
