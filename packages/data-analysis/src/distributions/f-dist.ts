/**
 * F-distribution CDF — used by ANOVA for p-values.
 *   F(x; d1, d2) = I_{d1 x / (d1 x + d2)}(d1/2, d2/2)
 */

import { regularisedIncompleteBeta } from '../util/special.js';

export function fCdf(x: number, d1: number, d2: number): number {
  if (x <= 0 || d1 <= 0 || d2 <= 0) return 0;
  return regularisedIncompleteBeta((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2);
}

export function fUpperTail(x: number, d1: number, d2: number): number {
  return 1 - fCdf(x, d1, d2);
}
