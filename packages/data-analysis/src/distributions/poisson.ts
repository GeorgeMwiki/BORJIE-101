/**
 * Poisson distribution with rate λ.
 *   pmf(k) = λ^k e^(−λ) / k!
 *   mean = variance = λ
 */

import type { DiscreteDistribution } from '../types.js';
import { logGamma } from '../util/special.js';
import { mulberry32 } from '../util/rng.js';

function poissonPmfDirect(k: number, lambda: number): number {
  if (!Number.isInteger(k) || k < 0) return 0;
  // log space to avoid overflow for large λ
  return Math.exp(k * Math.log(lambda) - lambda - logGamma(k + 1));
}

export function poisson(lambda: number): DiscreteDistribution {
  if (lambda <= 0) {
    throw new Error(`poisson: lambda must be positive; got ${lambda}`);
  }
  return {
    name: 'poisson',
    mean: lambda,
    variance: lambda,
    pmf: (k: number) => poissonPmfDirect(k, lambda),
    cdf: (k: number) => {
      if (k < 0) return 0;
      const kk = Math.floor(k);
      let s = 0;
      for (let i = 0; i <= kk; i += 1) {
        s += poissonPmfDirect(i, lambda);
      }
      return Math.min(1, s);
    },
    quantile: (p: number) => {
      if (p <= 0) return 0;
      let cum = 0;
      for (let k = 0; k < 1_000_000; k += 1) {
        cum += poissonPmfDirect(k, lambda);
        if (cum >= p - 1e-12) return k;
      }
      return 1_000_000;
    },
    sample: (n: number, seed?: number) => {
      // Knuth's algorithm — fine for moderate λ.
      const rng = mulberry32(seed);
      const L = Math.exp(-lambda);
      const out: number[] = [];
      for (let i = 0; i < n; i += 1) {
        let k = 0;
        let prod = 1;
        for (;;) {
          k += 1;
          prod *= rng();
          if (prod <= L) {
            out.push(k - 1);
            break;
          }
        }
      }
      return out;
    },
  };
}
