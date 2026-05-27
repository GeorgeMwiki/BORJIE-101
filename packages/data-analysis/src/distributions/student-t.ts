/**
 * Student's t-distribution — used internally by t-tests for the
 * two-sided p-value computation.
 *
 *   cdf(t; ν) = 1 − 0.5 · I_{ν/(t^2+ν)}(ν/2, 1/2)
 *
 * where I is the regularised incomplete beta.
 */

import { regularisedIncompleteBeta } from '../util/special.js';

export function studentTCdf(t: number, df: number): number {
  if (df <= 0 || Number.isNaN(t)) return Number.NaN;
  const x = df / (t * t + df);
  const upperTail = 0.5 * regularisedIncompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - upperTail : upperTail;
}

export function studentTTwoSidedPValue(t: number, df: number): number {
  if (df <= 0 || Number.isNaN(t)) return Number.NaN;
  const x = df / (t * t + df);
  return regularisedIncompleteBeta(x, df / 2, 0.5);
}
