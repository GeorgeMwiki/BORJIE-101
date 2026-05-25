/**
 * Demographic Parity (a.k.a. statistical parity).
 *
 * Definition: a classifier satisfies demographic parity if
 *   P(Y_hat = 1 | A = a) == P(Y_hat = 1 | A = b) for all groups a, b.
 *
 * Reference: Dwork et al. "Fairness through awareness" 2012;
 * implementation conventions per AIF360 + Fairlearn.
 */

import type { BiasMetric, DisparityScore, FairnessRow } from '../types.js';
import { countByGroup, groupKeys, minMax, selectionRate } from './helpers.js';
import { thresholdFor } from './thresholds.js';

const METRIC: BiasMetric = 'demographic_parity';

export function demographicParity(args: {
  rows: ReadonlyArray<FairnessRow>;
  thresholdOverride?: number;
}): DisparityScore {
  const counts = countByGroup(args.rows);
  const groups = groupKeys(counts);
  const perGroup: Record<string, number> = {};
  const rates: number[] = [];
  for (const g of groups) {
    const r = selectionRate(counts[g]!);
    perGroup[g] = r;
    rates.push(r);
  }
  const [lo, hi] = minMax(rates);
  // Score: max absolute difference between any two groups.
  const score = hi - lo;
  const threshold =
    args.thresholdOverride !== undefined
      ? args.thresholdOverride
      : thresholdFor(METRIC);
  const violates = score > threshold;
  const interpretation = violates
    ? `Selection rates differ by ${(score * 100).toFixed(1)}% across groups — exceeds ${(threshold * 100).toFixed(0)}% threshold.`
    : `Selection rates within ${(threshold * 100).toFixed(0)}% threshold across all groups.`;
  return {
    metric: METRIC,
    score,
    perGroup,
    violates,
    threshold,
    interpretation,
  };
}
