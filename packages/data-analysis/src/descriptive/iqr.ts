/**
 * Inter-quartile range — Q3 minus Q1, using the type-7 linear-interpolation
 * quantile definition.
 */

import { quantile } from './quantile.js';

export function iqr(values: ReadonlyArray<number>): number {
  return quantile(values, 0.75) - quantile(values, 0.25);
}
