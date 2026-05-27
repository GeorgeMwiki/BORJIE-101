/**
 * Sample standard deviation — square root of sample variance.
 */

import { variance } from './variance.js';

export function stddev(
  values: ReadonlyArray<number>,
  populationDenominator: boolean = false,
): number {
  return Math.sqrt(variance(values, populationDenominator));
}
