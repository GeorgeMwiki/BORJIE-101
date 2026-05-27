/**
 * Exponential distribution with rate parameter λ.
 *   pdf(x) = λ e^(−λ x), x ≥ 0
 *   cdf(x) = 1 − e^(−λ x)
 *   quantile(p) = −ln(1 − p) / λ
 */

import type { ContinuousDistribution } from '../types.js';
import { mulberry32 } from '../util/rng.js';

export function exponential(lambda: number = 1): ContinuousDistribution {
  if (lambda <= 0) {
    throw new Error(`exponential: lambda must be positive; got ${lambda}`);
  }
  return {
    name: 'exponential',
    mean: 1 / lambda,
    variance: 1 / (lambda * lambda),
    pdf: (x: number) => (x < 0 ? 0 : lambda * Math.exp(-lambda * x)),
    cdf: (x: number) => (x < 0 ? 0 : 1 - Math.exp(-lambda * x)),
    quantile: (p: number) => {
      if (p <= 0) return 0;
      if (p >= 1) return Infinity;
      return -Math.log(1 - p) / lambda;
    },
    sample: (n: number, seed?: number) => {
      const rng = mulberry32(seed);
      const out: number[] = [];
      for (let i = 0; i < n; i += 1) {
        out.push(-Math.log(1 - rng()) / lambda);
      }
      return out;
    },
  };
}
