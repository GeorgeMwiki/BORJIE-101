/**
 * Gamma distribution (shape k, scale θ).
 *   mean      = k θ
 *   variance  = k θ^2
 *
 * Sampling uses Marsaglia-Tsang (2000) for k ≥ 1 and the Johnk
 * boost-trick for k < 1.
 *
 * Reference: Marsaglia, G. & Tsang, W. W. (2000). *A simple method for
 * generating gamma variables.* ACM Transactions on Mathematical Software
 * 26(3):363-372.
 */

import type { ContinuousDistribution } from '../types.js';
import { gamma as gammaFn, regularisedGammaP } from '../util/special.js';
import { mulberry32, gaussianPair, type Prng } from '../util/rng.js';

function quantileBisect(k: number, theta: number, p: number): number {
  // Robust monotone bisection on the CDF — fine for our use sizes.
  let lo = 0;
  let hi = Math.max(10, k * theta * 10);
  while (regularisedGammaP(k, hi / theta) < p) {
    hi *= 2;
    if (hi > 1e15) return hi;
  }
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (regularisedGammaP(k, mid / theta) < p) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 1e-10) break;
  }
  return (lo + hi) / 2;
}

function gammaSampleMarsaglia(k: number, rng: Prng): number {
  if (k < 1) {
    // Boost: G(k) = G(k + 1) · U^(1/k)
    const g = gammaSampleMarsaglia(k + 1, rng);
    return g * Math.pow(rng(), 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  let buf: [number, number] | null = null;
  for (;;) {
    let x: number;
    if (buf === null) {
      const pair = gaussianPair(rng);
      buf = [pair[0], pair[1]];
      x = buf[0];
    } else {
      x = buf[1];
      buf = null;
    }
    const v = Math.pow(1 + c * x, 3);
    if (v <= 0) continue;
    const u = rng();
    const cond = 0.5 * x * x + d - d * v + d * Math.log(v);
    if (Math.log(u) < cond) {
      return d * v;
    }
  }
}

export function gammaDist(shape: number = 1, scale: number = 1): ContinuousDistribution {
  if (shape <= 0 || scale <= 0) {
    throw new Error(`gamma: shape and scale must be positive; got ${shape}, ${scale}`);
  }
  const norm = Math.pow(scale, shape) * gammaFn(shape);
  return {
    name: 'gamma',
    mean: shape * scale,
    variance: shape * scale * scale,
    pdf: (x: number) => {
      if (x <= 0) return 0;
      return (Math.pow(x, shape - 1) * Math.exp(-x / scale)) / norm;
    },
    cdf: (x: number) => (x <= 0 ? 0 : regularisedGammaP(shape, x / scale)),
    quantile: (p: number) => quantileBisect(shape, scale, p),
    sample: (n: number, seed?: number) => {
      const rng = mulberry32(seed);
      const out: number[] = [];
      for (let i = 0; i < n; i += 1) {
        out.push(gammaSampleMarsaglia(shape, rng) * scale);
      }
      return out;
    },
  };
}
