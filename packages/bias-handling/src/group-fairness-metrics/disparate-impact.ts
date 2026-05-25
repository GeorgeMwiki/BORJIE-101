/**
 * Disparate Impact (a.k.a. "80% rule" or "four-fifths rule").
 *
 * Definition:
 *   DI = P(Y_hat = 1 | A = unpriv) / P(Y_hat = 1 | A = priv)
 *
 * Per the US EEOC Uniform Guidelines on Employee Selection
 * Procedures, 29 CFR § 1607.4(D), a ratio less than 0.8 is
 * generally treated as evidence of adverse impact. The default
 * threshold (0.8) we treat as the *floor* — DI < 0.8 violates.
 *
 * Implementation: scan all unprivileged groups, report the
 * worst (lowest) ratio.
 */

import type { BiasMetric, DisparityScore, FairnessRow } from '../types.js';
import { countByGroup, groupKeys, selectionRate } from './helpers.js';
import { thresholdFor } from './thresholds.js';

const METRIC: BiasMetric = 'disparate_impact';

export function disparateImpact(args: {
  rows: ReadonlyArray<FairnessRow>;
  privilegedGroup: string;
  thresholdOverride?: number;
}): DisparityScore {
  const counts = countByGroup(args.rows);
  if (!counts[args.privilegedGroup]) {
    throw new Error(
      `[bias-handling] privilegedGroup '${args.privilegedGroup}' not present in rows.`,
    );
  }
  const privRate = selectionRate(counts[args.privilegedGroup]!);
  if (privRate === 0) {
    // Degenerate: nobody from priv group selected. Surface as 1.0
    // (no relative disparity computable) but flag.
    const perGroup: Record<string, number> = {};
    for (const g of groupKeys(counts)) {
      perGroup[g] = selectionRate(counts[g]!);
    }
    return {
      metric: METRIC,
      score: 1.0,
      perGroup,
      violates: false,
      threshold: thresholdFor(METRIC, { disparate_impact: args.thresholdOverride ?? thresholdFor(METRIC) }),
      interpretation:
        'Privileged group has zero selection rate — disparate impact ratio undefined.',
    };
  }
  const perGroup: Record<string, number> = {};
  let worstRatio = Infinity;
  for (const g of groupKeys(counts)) {
    const r = selectionRate(counts[g]!);
    perGroup[g] = r;
    if (g === args.privilegedGroup) continue;
    const ratio = r / privRate;
    if (ratio < worstRatio) worstRatio = ratio;
  }
  if (worstRatio === Infinity) worstRatio = 1.0;
  const threshold =
    args.thresholdOverride !== undefined
      ? args.thresholdOverride
      : thresholdFor(METRIC);
  const violates = worstRatio < threshold;
  const interpretation = violates
    ? `Worst DI = ${worstRatio.toFixed(3)} < ${threshold} (EEOC 80% rule violated).`
    : `Worst DI = ${worstRatio.toFixed(3)} meets 80% rule.`;
  return {
    metric: METRIC,
    score: worstRatio,
    perGroup,
    violates,
    threshold,
    interpretation,
  };
}
