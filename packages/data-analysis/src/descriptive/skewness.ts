/**
 * Adjusted Fisher-Pearson skewness coefficient (G1, type-2):
 *
 *   g1 = (1/n) Σ (x − x̄)^3 / s^3
 *   G1 = sqrt(n(n−1)) / (n−2) · g1
 *
 * This matches Excel's SKEW() and R's e1071::skewness(type=2).
 * Requires n ≥ 3.
 */

import { mean } from './mean.js';

export function skewness(values: ReadonlyArray<number>): number {
  const n = values.length;
  if (n < 3) {
    throw new Error(`skewness: requires n ≥ 3; got ${n}`);
  }
  const m = mean(values);
  let m2 = 0;
  let m3 = 0;
  for (const v of values) {
    const d = v - m;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= n;
  m3 /= n;
  if (m2 === 0) return 0;
  const g1 = m3 / Math.pow(m2, 1.5);
  return (Math.sqrt(n * (n - 1)) / (n - 2)) * g1;
}
