/**
 * Bootstrap confidence interval — pure TypeScript.
 *
 * The non-parametric percentile bootstrap: resample N observations
 * with replacement, recompute the estimator, repeat B times, and
 * report the 100*(1 - alpha) % CI as the [alpha/2, 1 - alpha/2]
 * quantiles of the B replications.
 *
 * Deterministic via the supplied seed so unit tests are reproducible.
 *
 * Reference: Efron, B. (1979) — "Bootstrap methods: another look at
 * the jackknife".
 *
 * @module @borjie/causal-inference/refute/bootstrap
 */

import { mulberry32 } from './prng.js';

export interface BootstrapOptions {
  /** Number of bootstrap replications. Default 1000. */
  readonly numReplications?: number;
  /** Significance level. Default 0.05 -> 95 % CI. */
  readonly alpha?: number;
  /** Deterministic seed. Default 1729. */
  readonly seed?: number;
}

export interface BootstrapResult<O> {
  readonly meanEstimate: number;
  readonly ciLow: number;
  readonly ciHigh: number;
  /** Standard error across replications. */
  readonly standardError: number;
  /** First replication's resampled observations — for debugging only. */
  readonly sampleResample: ReadonlyArray<O>;
}

export function bootstrap<O>(
  observations: ReadonlyArray<O>,
  estimator: (obs: ReadonlyArray<O>) => number,
  options: BootstrapOptions = {},
): BootstrapResult<O> {
  const reps = Math.max(1, options.numReplications ?? 1000);
  const alpha = options.alpha ?? 0.05;
  const rng = mulberry32(options.seed ?? 1729);
  const n = observations.length;
  const estimates: number[] = new Array(reps).fill(0) as number[];
  let firstResample: ReadonlyArray<O> = [];
  for (let r = 0; r < reps; r += 1) {
    const resample: O[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const j = Math.floor(rng() * n);
      resample[i] = observations[j] as O;
    }
    if (r === 0) firstResample = resample.slice();
    estimates[r] = estimator(resample);
  }
  const sorted = [...estimates].sort((a, b) => a - b);
  const ciLow = quantile(sorted, alpha / 2);
  const ciHigh = quantile(sorted, 1 - alpha / 2);
  let mean = 0;
  for (const e of estimates) mean += e;
  mean /= Math.max(1, estimates.length);
  let varSum = 0;
  for (const e of estimates) varSum += (e - mean) * (e - mean);
  const se = Math.sqrt(varSum / Math.max(1, estimates.length - 1));
  return Object.freeze({
    meanEstimate: mean,
    ciLow,
    ciHigh,
    standardError: se,
    sampleResample: firstResample,
  });
}

function quantile(sorted: ReadonlyArray<number>, q: number): number {
  if (sorted.length === 0) return 0;
  if (q <= 0) return sorted[0] as number;
  if (q >= 1) return sorted[sorted.length - 1] as number;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return (
    (sorted[lo] as number) * (1 - frac) +
    (sorted[hi] as number) * frac
  );
}
