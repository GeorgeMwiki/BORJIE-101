/**
 * Equal Opportunity (Hardt et al. 2016).
 *
 * A *relaxation* of equalized odds: requires only TPR parity
 * across groups for the positive class. Useful when false
 * positives are less harmful than false negatives (e.g. loan
 * approvals where we tolerate the occasional unfair-positive but
 * not the systematic unfair-negative).
 *
 * Score: max(TPR) − min(TPR).
 */

import type { BiasMetric, DisparityScore, FairnessRow } from '../types.js';
import { countByGroup, groupKeys, minMax, truePositiveRate } from './helpers.js';
import { thresholdFor } from './thresholds.js';

const METRIC: BiasMetric = 'equal_opportunity';

export function equalOpportunity(args: {
  rows: ReadonlyArray<FairnessRow>;
  thresholdOverride?: number;
}): DisparityScore {
  const counts = countByGroup(args.rows);
  const groups = groupKeys(counts);
  for (const g of groups) {
    if (!counts[g]!.hasLabels) {
      throw new Error(
        `[bias-handling] equalOpportunity requires labels for every row (missing in '${g}').`,
      );
    }
  }
  const perGroup: Record<string, number> = {};
  const tprs: number[] = [];
  for (const g of groups) {
    const tpr = truePositiveRate(counts[g]!);
    perGroup[g] = tpr;
    tprs.push(tpr);
  }
  const [lo, hi] = minMax(tprs);
  const score = hi - lo;
  const threshold =
    args.thresholdOverride !== undefined
      ? args.thresholdOverride
      : thresholdFor(METRIC);
  const violates = score > threshold;
  const interpretation = violates
    ? `TPR-gap = ${score.toFixed(3)} exceeds ${threshold}.`
    : `TPR-gap = ${score.toFixed(3)} within ${threshold}.`;
  return {
    metric: METRIC,
    score,
    perGroup,
    violates,
    threshold,
    interpretation,
  };
}
