/**
 * False Omission Rate parity.
 *
 *   FOR = FN / (FN + TN)
 *
 * Useful where false negatives carry a high cost (e.g. denying a
 * deserving applicant a loan).
 */

import type { BiasMetric, DisparityScore, FairnessRow } from '../types.js';
import { countByGroup, falseOmissionRate, groupKeys, minMax } from './helpers.js';
import { thresholdFor } from './thresholds.js';

const METRIC: BiasMetric = 'false_omission_rate';

export function falseOmissionRateParity(args: {
  rows: ReadonlyArray<FairnessRow>;
  thresholdOverride?: number;
}): DisparityScore {
  const counts = countByGroup(args.rows);
  const groups = groupKeys(counts);
  for (const g of groups) {
    if (!counts[g]!.hasLabels) {
      throw new Error(
        `[bias-handling] falseOmissionRateParity requires labels for every row (missing in '${g}').`,
      );
    }
  }
  const perGroup: Record<string, number> = {};
  const rates: number[] = [];
  for (const g of groups) {
    const v = falseOmissionRate(counts[g]!);
    perGroup[g] = v;
    rates.push(v);
  }
  const [lo, hi] = minMax(rates);
  const score = hi - lo;
  const threshold =
    args.thresholdOverride !== undefined
      ? args.thresholdOverride
      : thresholdFor(METRIC);
  const violates = score > threshold;
  const interpretation = violates
    ? `FOR gap = ${score.toFixed(3)} exceeds ${threshold}.`
    : `FOR gap = ${score.toFixed(3)} within ${threshold}.`;
  return {
    metric: METRIC,
    score,
    perGroup,
    violates,
    threshold,
    interpretation,
  };
}
