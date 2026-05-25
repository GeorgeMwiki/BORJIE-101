/**
 * Predictive Parity (Chouldechova 2017).
 *
 * Requires PPV (precision) parity across groups:
 *   P(Y = 1 | Y_hat = 1, A = a) ≈ P(Y = 1 | Y_hat = 1, A = b)
 *
 * Score: max(PPV) − min(PPV).
 */

import type { BiasMetric, DisparityScore, FairnessRow } from '../types.js';
import {
  countByGroup,
  groupKeys,
  minMax,
  positivePredictiveValue,
} from './helpers.js';
import { thresholdFor } from './thresholds.js';

const METRIC: BiasMetric = 'predictive_parity';

export function predictiveParity(args: {
  rows: ReadonlyArray<FairnessRow>;
  thresholdOverride?: number;
}): DisparityScore {
  const counts = countByGroup(args.rows);
  const groups = groupKeys(counts);
  for (const g of groups) {
    if (!counts[g]!.hasLabels) {
      throw new Error(
        `[bias-handling] predictiveParity requires labels for every row (missing in '${g}').`,
      );
    }
  }
  const perGroup: Record<string, number> = {};
  const ppvs: number[] = [];
  for (const g of groups) {
    const ppv = positivePredictiveValue(counts[g]!);
    perGroup[g] = ppv;
    ppvs.push(ppv);
  }
  const [lo, hi] = minMax(ppvs);
  const score = hi - lo;
  const threshold =
    args.thresholdOverride !== undefined
      ? args.thresholdOverride
      : thresholdFor(METRIC);
  const violates = score > threshold;
  const interpretation = violates
    ? `PPV gap = ${score.toFixed(3)} exceeds ${threshold}.`
    : `PPV gap = ${score.toFixed(3)} within ${threshold}.`;
  return {
    metric: METRIC,
    score,
    perGroup,
    violates,
    threshold,
    interpretation,
  };
}
