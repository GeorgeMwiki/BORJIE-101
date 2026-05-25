/**
 * False Discovery Rate parity.
 *
 *   FDR = FP / (FP + TP)
 *
 * Useful where false positives carry a high cost (e.g. flagging
 * a tenant as fraud).
 */

import type { BiasMetric, DisparityScore, FairnessRow } from '../types.js';
import { countByGroup, falseDiscoveryRate, groupKeys, minMax } from './helpers.js';
import { thresholdFor } from './thresholds.js';

const METRIC: BiasMetric = 'false_discovery_rate';

export function falseDiscoveryRateParity(args: {
  rows: ReadonlyArray<FairnessRow>;
  thresholdOverride?: number;
}): DisparityScore {
  const counts = countByGroup(args.rows);
  const groups = groupKeys(counts);
  for (const g of groups) {
    if (!counts[g]!.hasLabels) {
      throw new Error(
        `[bias-handling] falseDiscoveryRateParity requires labels for every row (missing in '${g}').`,
      );
    }
  }
  const perGroup: Record<string, number> = {};
  const rates: number[] = [];
  for (const g of groups) {
    const v = falseDiscoveryRate(counts[g]!);
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
    ? `FDR gap = ${score.toFixed(3)} exceeds ${threshold}.`
    : `FDR gap = ${score.toFixed(3)} within ${threshold}.`;
  return {
    metric: METRIC,
    score,
    perGroup,
    violates,
    threshold,
    interpretation,
  };
}
