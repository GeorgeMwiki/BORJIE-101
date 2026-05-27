/**
 * Pearson product-moment correlation coefficient.
 *
 *   r = Σ(x − x̄)(y − ȳ) / √(Σ(x − x̄)^2 · Σ(y − ȳ)^2)
 *
 * Reference: Pearson, K. (1895). *Notes on regression and inheritance
 * in the case of two parents.* Proceedings of the Royal Society of
 * London 58:240-242. URL: <https://www.jstor.org/stable/115794>.
 * Date checked: 2026-05-27.
 */

import { mean } from '../descriptive/mean.js';

export function pearson(
  x: ReadonlyArray<number>,
  y: ReadonlyArray<number>,
): number {
  if (x.length !== y.length) {
    throw new Error('pearson: x and y must have equal length');
  }
  if (x.length < 2) {
    throw new Error('pearson: need n ≥ 2');
  }
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const a = (x[i] as number) - mx;
    const b = (y[i] as number) - my;
    num += a * b;
    dx2 += a * a;
    dy2 += b * b;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return 0;
  return num / denom;
}
