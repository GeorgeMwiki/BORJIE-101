/**
 * One-way ANOVA.
 *
 *   F = MS_between / MS_within,
 *   df_between = k − 1,
 *   df_within  = N − k
 *
 * Reference: Fisher, R. A. (1925). *Statistical Methods for Research
 * Workers.* Oliver & Boyd. URL: <https://psychclassics.yorku.ca/Fisher/Methods/>.
 * Date checked: 2026-05-27.
 */

import type { HypothesisTestResult } from '../types.js';
import { mean } from '../descriptive/mean.js';
import { fUpperTail } from '../distributions/f-dist.js';

export function anovaOneWay(
  groups: ReadonlyArray<ReadonlyArray<number>>,
  alpha: number = 0.05,
): HypothesisTestResult {
  if (groups.length < 2) {
    throw new Error('anovaOneWay: need ≥ 2 groups');
  }
  const all: number[] = [];
  for (const g of groups) {
    if (g.length < 2) throw new Error('anovaOneWay: each group needs ≥ 2 obs');
    for (const v of g) all.push(v);
  }
  const grandMean = mean(all);
  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of groups) {
    const m = mean(g);
    ssBetween += g.length * Math.pow(m - grandMean, 2);
    for (const v of g) {
      ssWithin += Math.pow(v - m, 2);
    }
  }
  const k = groups.length;
  const N = all.length;
  const dfBetween = k - 1;
  const dfWithin = N - k;
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const F = msBetween / msWithin;
  const pValue = fUpperTail(F, dfBetween, dfWithin);
  return {
    statistic: F,
    pValue,
    df: dfBetween,
    alternative: 'greater',
    testName: 'one-way ANOVA',
    nObservations: N,
    rejectH0: pValue < alpha,
    alpha,
  };
}
