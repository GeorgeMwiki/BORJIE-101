/**
 * Beta distribution (shape α, β) on [0, 1].
 *   pdf(x) = x^(α−1) (1−x)^(β−1) / B(α, β)
 *
 * Sampling via two Gamma draws: X / (X + Y), X ~ Γ(α), Y ~ Γ(β).
 */

import type { ContinuousDistribution } from '../types.js';
import {
  logBeta,
  regularisedIncompleteBeta,
} from '../util/special.js';
import { mulberry32, gaussianPair, type Prng } from '../util/rng.js';

function gammaSample(shape: number, rng: Prng): number {
  if (shape < 1) {
    const g = gammaSample(shape + 1, rng);
    return g * Math.pow(rng(), 1 / shape);
  }
  const d = shape - 1 / 3;
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
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) {
      return d * v;
    }
  }
}

function quantileBisect(alpha: number, beta: number, p: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (regularisedIncompleteBeta(mid, alpha, beta) < p) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}

export function betaDist(alpha: number, betaShape: number): ContinuousDistribution {
  if (alpha <= 0 || betaShape <= 0) {
    throw new Error(`beta: alpha and beta must be positive; got ${alpha}, ${betaShape}`);
  }
  const logB = logBeta(alpha, betaShape);
  const mean = alpha / (alpha + betaShape);
  const variance =
    (alpha * betaShape) /
    ((alpha + betaShape) * (alpha + betaShape) * (alpha + betaShape + 1));
  return {
    name: 'beta',
    mean,
    variance,
    pdf: (x: number) => {
      if (x <= 0 || x >= 1) return 0;
      return Math.exp((alpha - 1) * Math.log(x) + (betaShape - 1) * Math.log(1 - x) - logB);
    },
    cdf: (x: number) => regularisedIncompleteBeta(x, alpha, betaShape),
    quantile: (p: number) => {
      if (p <= 0) return 0;
      if (p >= 1) return 1;
      return quantileBisect(alpha, betaShape, p);
    },
    sample: (n: number, seed?: number) => {
      const rng = mulberry32(seed);
      const out: number[] = [];
      for (let i = 0; i < n; i += 1) {
        const x = gammaSample(alpha, rng);
        const y = gammaSample(betaShape, rng);
        out.push(x / (x + y));
      }
      return out;
    },
  };
}
