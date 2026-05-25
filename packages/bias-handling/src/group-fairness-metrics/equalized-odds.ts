/**
 * Equalized Odds (Hardt, Price, Srebro 2016 — "Equality of
 * Opportunity in Supervised Learning").
 *
 * Definition: classifier satisfies equalized odds if for both
 * Y = 0 and Y = 1, the prediction Y_hat is independent of A given Y.
 * Equivalently: TPR and FPR are equal across all groups.
 *
 * Score: max( max(TPR) − min(TPR), max(FPR) − min(FPR) ).
 */

import type { BiasMetric, DisparityScore, FairnessRow } from '../types.js';
import {
  countByGroup,
  falsePositiveRate,
  groupKeys,
  minMax,
  truePositiveRate,
} from './helpers.js';
import { thresholdFor } from './thresholds.js';

const METRIC: BiasMetric = 'equalized_odds';

export function equalizedOdds(args: {
  rows: ReadonlyArray<FairnessRow>;
  thresholdOverride?: number;
}): DisparityScore {
  const counts = countByGroup(args.rows);
  const groups = groupKeys(counts);
  for (const g of groups) {
    if (!counts[g]!.hasLabels) {
      throw new Error(
        `[bias-handling] equalizedOdds requires ground-truth labels for every row (missing in group '${g}').`,
      );
    }
  }
  const perGroup: Record<string, number> = {};
  const tprs: number[] = [];
  const fprs: number[] = [];
  for (const g of groups) {
    const tpr = truePositiveRate(counts[g]!);
    const fpr = falsePositiveRate(counts[g]!);
    // perGroup reports the combined dist via `tpr` field; we mirror
    // both in the interpretation. We encode TPR here.
    perGroup[g] = tpr;
    tprs.push(tpr);
    fprs.push(fpr);
  }
  const [tprLo, tprHi] = minMax(tprs);
  const [fprLo, fprHi] = minMax(fprs);
  const tprGap = tprHi - tprLo;
  const fprGap = fprHi - fprLo;
  const score = Math.max(tprGap, fprGap);
  const threshold =
    args.thresholdOverride !== undefined
      ? args.thresholdOverride
      : thresholdFor(METRIC);
  const violates = score > threshold;
  const interpretation = violates
    ? `Worst TPR-gap=${tprGap.toFixed(3)}, FPR-gap=${fprGap.toFixed(3)} — exceeds ${threshold}.`
    : `Both TPR-gap and FPR-gap within ${threshold} across groups.`;
  return {
    metric: METRIC,
    score,
    perGroup,
    violates,
    threshold,
    interpretation,
  };
}
