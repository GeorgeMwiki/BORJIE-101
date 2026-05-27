/**
 * Excess kurtosis (type-2, sample-adjusted):
 *
 *   g2 = (1/n) Σ (x − x̄)^4 / s^4 − 3
 *   G2 = ((n+1)/(n−2)(n−3)) · ((n−1) g2 + 6)
 *
 * Matches Excel's KURT() and R's e1071::kurtosis(type=2).
 * Requires n ≥ 4. A normal distribution returns 0.
 */

import { mean } from './mean.js';

export function kurtosis(values: ReadonlyArray<number>): number {
  const n = values.length;
  if (n < 4) {
    throw new Error(`kurtosis: requires n ≥ 4; got ${n}`);
  }
  const m = mean(values);
  let m2 = 0;
  let m4 = 0;
  for (const v of values) {
    const d = v - m;
    const d2 = d * d;
    m2 += d2;
    m4 += d2 * d2;
  }
  m2 /= n;
  m4 /= n;
  if (m2 === 0) return 0;
  const g2 = m4 / (m2 * m2) - 3;
  return ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6);
}
