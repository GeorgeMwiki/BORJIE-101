/**
 * One-shot descriptive summary — composes the individual primitives
 * into the canonical {@link DescriptiveStats} shape.
 */

import type { DescriptiveStats } from '../types.js';
import { mean } from './mean.js';
import { median } from './median.js';
import { variance } from './variance.js';
import { stddev } from './stddev.js';
import { quantile } from './quantile.js';
import { iqr } from './iqr.js';
import { skewness } from './skewness.js';
import { kurtosis } from './kurtosis.js';

export function describe(values: ReadonlyArray<number>): DescriptiveStats {
  if (values.length === 0) {
    throw new Error('describe: cannot describe empty vector');
  }
  let min = values[0] as number;
  let max = values[0] as number;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const n = values.length;
  const m = mean(values);
  const md = median(values);
  // Variance / skewness / kurtosis with fallbacks when n is too small.
  const v = n >= 2 ? variance(values) : 0;
  const sd = n >= 2 ? stddev(values) : 0;
  const sk = n >= 3 ? skewness(values) : 0;
  const ku = n >= 4 ? kurtosis(values) : 0;
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  return {
    n,
    mean: m,
    median: md,
    variance: v,
    stddev: sd,
    min,
    max,
    range: max - min,
    q1,
    q3,
    iqr: n >= 2 ? iqr(values) : 0,
    skewness: sk,
    kurtosis: ku,
  };
}
