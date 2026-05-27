/**
 * Normal (Gaussian) distribution.
 * Reference: jStat normal — https://github.com/jstat/jstat
 */

import type { ContinuousDistribution } from '../types.js';
import { erf, erfInv } from '../util/special.js';
import { mulberry32, gaussianPair, type Prng } from '../util/rng.js';

export function normal(mu: number = 0, sigma: number = 1): ContinuousDistribution {
  if (sigma <= 0) {
    throw new Error(`normal: sigma must be positive; got ${sigma}`);
  }
  const SQRT_2PI = Math.sqrt(2 * Math.PI);
  return {
    name: 'normal',
    mean: mu,
    variance: sigma * sigma,
    pdf: (x: number) => {
      const z = (x - mu) / sigma;
      return Math.exp(-0.5 * z * z) / (sigma * SQRT_2PI);
    },
    cdf: (x: number) => 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2))),
    quantile: (p: number) => {
      if (p <= 0) return -Infinity;
      if (p >= 1) return Infinity;
      return mu + sigma * Math.SQRT2 * erfInv(2 * p - 1);
    },
    sample: (n: number, seed?: number) => {
      const rng: Prng = mulberry32(seed);
      const out: number[] = [];
      while (out.length < n) {
        const [a, b] = gaussianPair(rng);
        out.push(mu + sigma * a);
        if (out.length < n) out.push(mu + sigma * b);
      }
      return out;
    },
  };
}
