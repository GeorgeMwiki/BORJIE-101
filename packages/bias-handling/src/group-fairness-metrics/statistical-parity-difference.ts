/**
 * Statistical Parity Difference.
 *
 * Signed difference between privileged and unprivileged group's
 * selection rate. Caller designates which group is "privileged"
 * (i.e. baseline / reference) via `privilegedGroup`.
 *
 *   SPD = P(Y_hat=1 | A=unpriv) − P(Y_hat=1 | A=priv)
 *
 * A negative value means the unprivileged group is selected
 * less often than the privileged group (the typical direction of
 * harm); a positive value means the opposite.
 *
 * Reference: AIF360 `statistical_parity_difference`.
 */

import type { BiasMetric, DisparityScore, FairnessRow } from '../types.js';
import { countByGroup, groupKeys, selectionRate } from './helpers.js';
import { thresholdFor } from './thresholds.js';

const METRIC: BiasMetric = 'statistical_parity_difference';

export function statisticalParityDifference(args: {
  rows: ReadonlyArray<FairnessRow>;
  privilegedGroup: string;
  thresholdOverride?: number;
}): DisparityScore {
  const counts = countByGroup(args.rows);
  const groups = groupKeys(counts);
  if (!counts[args.privilegedGroup]) {
    throw new Error(
      `[bias-handling] privilegedGroup '${args.privilegedGroup}' not present in rows.`,
    );
  }
  const privRate = selectionRate(counts[args.privilegedGroup]!);
  const perGroup: Record<string, number> = {};
  let worstAbs = 0;
  let worstSigned = 0;
  for (const g of groups) {
    const r = selectionRate(counts[g]!);
    perGroup[g] = r;
    if (g === args.privilegedGroup) continue;
    const signed = r - privRate;
    if (Math.abs(signed) > worstAbs) {
      worstAbs = Math.abs(signed);
      worstSigned = signed;
    }
  }
  const threshold =
    args.thresholdOverride !== undefined
      ? args.thresholdOverride
      : thresholdFor(METRIC);
  const violates = worstAbs > threshold;
  const interpretation = violates
    ? `Worst |SPD| = ${worstAbs.toFixed(3)} (signed ${worstSigned.toFixed(3)}) exceeds threshold ${threshold}.`
    : `All groups within ${threshold} of privileged group's selection rate.`;
  return {
    metric: METRIC,
    score: worstSigned,
    perGroup,
    violates,
    threshold,
    interpretation,
  };
}
