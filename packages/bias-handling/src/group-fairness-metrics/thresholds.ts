/**
 * Default violation thresholds for the 8 group fairness metrics.
 *
 * Where there is statutory guidance we use it (e.g. EEOC's 80%
 * rule for disparate impact — 29 CFR § 1607.4(D)). Where there is
 * no statutory rule we use community defaults from AIF360 and
 * Fairlearn (typically 0.1 absolute difference is a common cut-off
 * for parity-difference style metrics).
 */

import type { BiasMetric } from '../types.js';

export const DEFAULT_THRESHOLDS: Readonly<Record<BiasMetric, number>> = {
  /** Absolute difference in selection rates. */
  demographic_parity: 0.1,
  /** EEOC 80% rule — ratio must be at least 0.8. We store the floor. */
  disparate_impact: 0.8,
  /** Max of TPR-diff, FPR-diff. */
  equalized_odds: 0.1,
  /** TPR difference for positive class only. */
  equal_opportunity: 0.1,
  /** PPV difference. */
  predictive_parity: 0.1,
  /** FDR difference. */
  false_discovery_rate: 0.1,
  /** FOR difference. */
  false_omission_rate: 0.1,
  /** Max group-wise calibration error difference. */
  calibration_within_groups: 0.1,
  /** Same magnitude as demographic_parity by convention. */
  statistical_parity_difference: 0.1,
};

/**
 * Pull a threshold, optionally overridden by caller's map.
 */
export function thresholdFor(
  metric: BiasMetric,
  overrides?: Partial<Record<BiasMetric, number>>,
): number {
  if (overrides && overrides[metric] !== undefined) {
    return overrides[metric] as number;
  }
  return DEFAULT_THRESHOLDS[metric];
}
