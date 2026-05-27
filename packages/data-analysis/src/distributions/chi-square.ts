/**
 * Chi-square distribution CDF for p-value computation:
 *   cdf(x; k) = P(k/2, x/2)
 * where P is the regularised lower incomplete gamma.
 */

import { regularisedGammaP } from '../util/special.js';

export function chiSquareCdf(x: number, k: number): number {
  if (x < 0 || k <= 0) return 0;
  return regularisedGammaP(k / 2, x / 2);
}

export function chiSquareUpperTail(x: number, k: number): number {
  return 1 - chiSquareCdf(x, k);
}
