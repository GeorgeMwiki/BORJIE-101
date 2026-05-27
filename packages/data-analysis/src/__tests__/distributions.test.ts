/**
 * Distributions — pdf / cdf / quantile against published references.
 */

import { describe as suite, it, expect } from 'vitest';
import { normal } from '../distributions/normal.js';
import { uniform } from '../distributions/uniform.js';
import { exponential } from '../distributions/exponential.js';
import { gammaDist } from '../distributions/gamma.js';
import { betaDist } from '../distributions/beta.js';
import { binomial } from '../distributions/binomial.js';
import { poisson } from '../distributions/poisson.js';

suite('distributions — reference vectors', () => {
  it('Standard normal cdf(0) = 0.5, cdf(1) ≈ 0.8413, cdf(1.96) ≈ 0.975', () => {
    const n = normal(0, 1);
    expect(n.cdf(0)).toBeCloseTo(0.5, 6);
    expect(n.cdf(1)).toBeCloseTo(0.8413, 3);
    expect(n.cdf(1.96)).toBeCloseTo(0.975, 3);
  });

  it('Standard normal quantile is the inverse of cdf within 5 decimals', () => {
    const n = normal(0, 1);
    for (const p of [0.1, 0.25, 0.5, 0.75, 0.9, 0.975]) {
      const x = n.quantile(p);
      expect(n.cdf(x)).toBeCloseTo(p, 5);
    }
  });

  it('Uniform(0,1) mean = 0.5, variance = 1/12', () => {
    const u = uniform(0, 1);
    expect(u.mean).toBeCloseTo(0.5, 12);
    expect(u.variance).toBeCloseTo(1 / 12, 12);
    expect(u.cdf(0.5)).toBeCloseTo(0.5, 12);
  });

  it('Exponential(λ=1) quantile(0.5) = ln(2), cdf at 1 = 1 − 1/e', () => {
    const e = exponential(1);
    expect(e.quantile(0.5)).toBeCloseTo(Math.LN2, 10);
    expect(e.cdf(1)).toBeCloseTo(1 - 1 / Math.E, 10);
  });

  it('Gamma(k=2, θ=2): mean = 4, variance = 8, cdf(4) ≈ 0.5940', () => {
    // SciPy: scipy.stats.gamma.cdf(4, a=2, scale=2) ≈ 0.5940
    const g = gammaDist(2, 2);
    expect(g.mean).toBe(4);
    expect(g.variance).toBe(8);
    expect(g.cdf(4)).toBeCloseTo(0.594, 2);
  });

  it('Beta(α=2, β=5) cdf(0.5) ≈ 0.890625', () => {
    // Closed form for I_{0.5}(2,5) = 0.890625
    const b = betaDist(2, 5);
    expect(b.cdf(0.5)).toBeCloseTo(0.890625, 4);
  });

  it('Binomial(n=10, p=0.5) pmf(5) ≈ 0.24609375', () => {
    // C(10,5) · 0.5^10 = 252 / 1024 = 0.24609375
    const b = binomial(10, 0.5);
    expect(b.pmf(5)).toBeCloseTo(0.24609375, 8);
    expect(b.mean).toBe(5);
    expect(b.variance).toBeCloseTo(2.5, 12);
  });

  it('Poisson(λ=3) pmf(2) ≈ 0.224041807655', () => {
    // 3^2 · e^-3 / 2! = 4.5 · 0.04979 ≈ 0.22404
    const p = poisson(3);
    expect(p.pmf(2)).toBeCloseTo(0.224042, 4);
    expect(p.mean).toBe(3);
    expect(p.variance).toBe(3);
  });
});
