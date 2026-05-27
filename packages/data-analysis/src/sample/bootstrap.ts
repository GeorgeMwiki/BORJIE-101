/**
 * Bootstrap resampling (Efron 1979) — empirical confidence interval
 * on any statistic of a vector.
 *
 *   1. Draw B samples of size n with replacement.
 *   2. Compute the statistic on each.
 *   3. Return percentile-method (1−α) CI.
 *
 * Reference: Efron, B. (1979). *Bootstrap methods: another look at the
 * jackknife.* Annals of Statistics 7(1):1-26.
 * URL: <https://doi.org/10.1214/aos/1176344552>. Date checked: 2026-05-27.
 */

import { mulberry32, type Prng } from '../util/rng.js';
import { quantile } from '../descriptive/quantile.js';

export interface BootstrapResult {
  readonly point: number;
  readonly low: number;
  readonly high: number;
  readonly nResamples: number;
  readonly alpha: number;
  readonly statistics: ReadonlyArray<number>;
}

export function bootstrap(
  values: ReadonlyArray<number>,
  stat: (xs: ReadonlyArray<number>) => number,
  nResamples: number = 2000,
  alpha: number = 0.05,
  seed?: number,
): BootstrapResult {
  if (values.length === 0) throw new Error('bootstrap: empty input');
  const rng: Prng = mulberry32(seed);
  const n = values.length;
  const stats: number[] = [];
  for (let b = 0; b < nResamples; b += 1) {
    const resample: number[] = [];
    for (let i = 0; i < n; i += 1) {
      resample.push(values[Math.floor(rng() * n)] as number);
    }
    stats.push(stat(resample));
  }
  const point = stat(values);
  const low = quantile(stats, alpha / 2);
  const high = quantile(stats, 1 - alpha / 2);
  return { point, low, high, nResamples, alpha, statistics: stats };
}
