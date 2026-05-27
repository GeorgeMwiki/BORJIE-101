/**
 * Pearson chi-square test of independence for a contingency table.
 *
 *   X² = Σ (O_ij − E_ij)^2 / E_ij,   df = (r − 1)(c − 1)
 *
 * Reference: Pearson, K. (1900). *On the criterion that a given system
 * of deviations from the probable in the case of a correlated system of
 * variables is such that it can be reasonably supposed to have arisen
 * from random sampling.* Philosophical Magazine 50(302):157-175.
 * URL: <https://www.tandfonline.com/doi/abs/10.1080/14786440009463897>.
 * Date checked: 2026-05-27.
 */

import type { HypothesisTestResult } from '../types.js';
import { chiSquareUpperTail } from '../distributions/chi-square.js';

export function chiSquareIndependence(
  observed: ReadonlyArray<ReadonlyArray<number>>,
  alpha: number = 0.05,
): HypothesisTestResult {
  const r = observed.length;
  if (r < 2) throw new Error('chiSquareIndependence: need ≥ 2 rows');
  const c = (observed[0] as ReadonlyArray<number>).length;
  if (c < 2) throw new Error('chiSquareIndependence: need ≥ 2 columns');
  const rowSums = new Array<number>(r).fill(0);
  const colSums = new Array<number>(c).fill(0);
  let total = 0;
  for (let i = 0; i < r; i += 1) {
    const row = observed[i] as ReadonlyArray<number>;
    if (row.length !== c) {
      throw new Error('chiSquareIndependence: ragged table');
    }
    for (let j = 0; j < c; j += 1) {
      const v = row[j] as number;
      if (v < 0 || !Number.isFinite(v)) {
        throw new Error('chiSquareIndependence: cells must be non-negative finite');
      }
      rowSums[i] = (rowSums[i] as number) + v;
      colSums[j] = (colSums[j] as number) + v;
      total += v;
    }
  }
  if (total === 0) throw new Error('chiSquareIndependence: empty table');
  let chi2 = 0;
  for (let i = 0; i < r; i += 1) {
    const row = observed[i] as ReadonlyArray<number>;
    for (let j = 0; j < c; j += 1) {
      const expected = ((rowSums[i] as number) * (colSums[j] as number)) / total;
      if (expected === 0) continue;
      const diff = (row[j] as number) - expected;
      chi2 += (diff * diff) / expected;
    }
  }
  const df = (r - 1) * (c - 1);
  const pValue = chiSquareUpperTail(chi2, df);
  return {
    statistic: chi2,
    pValue,
    df,
    alternative: 'two-sided',
    testName: 'chi-square test of independence',
    nObservations: total,
    rejectH0: pValue < alpha,
    alpha,
  };
}
