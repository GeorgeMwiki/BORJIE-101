/**
 * Binomial distribution Bin(n, p).
 *   mean      = n p
 *   variance  = n p (1 − p)
 */

import type { DiscreteDistribution } from '../types.js';
import { logGamma } from '../util/special.js';
import { mulberry32 } from '../util/rng.js';

function logChoose(n: number, k: number): number {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

export function binomial(n: number, p: number): DiscreteDistribution {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`binomial: n must be a non-negative integer; got ${n}`);
  }
  if (p < 0 || p > 1) {
    throw new Error(`binomial: p must be in [0, 1]; got ${p}`);
  }
  const logP = p === 0 ? -Infinity : Math.log(p);
  const log1mP = p === 1 ? -Infinity : Math.log(1 - p);
  return {
    name: 'binomial',
    mean: n * p,
    variance: n * p * (1 - p),
    pmf: (k: number) => {
      if (!Number.isInteger(k) || k < 0 || k > n) return 0;
      if (p === 0) return k === 0 ? 1 : 0;
      if (p === 1) return k === n ? 1 : 0;
      return Math.exp(logChoose(n, k) + k * logP + (n - k) * log1mP);
    },
    cdf: (k: number) => {
      if (k < 0) return 0;
      if (k >= n) return 1;
      const kk = Math.floor(k);
      let s = 0;
      for (let i = 0; i <= kk; i += 1) {
        if (p === 0) {
          s += i === 0 ? 1 : 0;
        } else if (p === 1) {
          s += i === n ? 1 : 0;
        } else {
          s += Math.exp(logChoose(n, i) + i * logP + (n - i) * log1mP);
        }
      }
      return Math.min(1, s);
    },
    quantile: (target: number) => {
      if (target <= 0) return 0;
      if (target >= 1) return n;
      let cum = 0;
      for (let k = 0; k <= n; k += 1) {
        if (p === 0) {
          cum = 1;
        } else if (p === 1) {
          cum = k === n ? 1 : 0;
        } else {
          cum += Math.exp(logChoose(n, k) + k * logP + (n - k) * log1mP);
        }
        if (cum >= target - 1e-12) return k;
      }
      return n;
    },
    sample: (count: number, seed?: number) => {
      const rng = mulberry32(seed);
      const out: number[] = [];
      for (let i = 0; i < count; i += 1) {
        let successes = 0;
        for (let trial = 0; trial < n; trial += 1) {
          if (rng() < p) successes += 1;
        }
        out.push(successes);
      }
      return out;
    },
  };
}
