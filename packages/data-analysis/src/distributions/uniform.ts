/**
 * Continuous uniform distribution on [a, b].
 */

import type { ContinuousDistribution } from '../types.js';
import { mulberry32 } from '../util/rng.js';

export function uniform(a: number = 0, b: number = 1): ContinuousDistribution {
  if (b <= a) {
    throw new Error(`uniform: require b > a; got a=${a}, b=${b}`);
  }
  const width = b - a;
  return {
    name: 'uniform',
    mean: (a + b) / 2,
    variance: (width * width) / 12,
    pdf: (x: number) => (x < a || x > b ? 0 : 1 / width),
    cdf: (x: number) => {
      if (x < a) return 0;
      if (x > b) return 1;
      return (x - a) / width;
    },
    quantile: (p: number) => {
      if (p <= 0) return a;
      if (p >= 1) return b;
      return a + p * width;
    },
    sample: (n: number, seed?: number) => {
      const rng = mulberry32(seed);
      const out: number[] = [];
      for (let i = 0; i < n; i += 1) {
        out.push(a + rng() * width);
      }
      return out;
    },
  };
}
