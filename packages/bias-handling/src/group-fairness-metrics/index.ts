/**
 * Group fairness metrics — AIF360-inspired (TypeScript port).
 *
 * 8 metrics implemented (each a pure function on FairnessRow[]):
 *   demographicParity, statisticalParityDifference, disparateImpact,
 *   equalizedOdds, equalOpportunity, predictiveParity,
 *   falseDiscoveryRateParity, falseOmissionRateParity,
 *   calibrationWithinGroups.
 *
 * (That's 9 entry points covering 8 distinct mathematical metrics
 * — statistical_parity_difference and demographic_parity are two
 * common framings of the same family; we expose both because the
 * AIF360 / Fairlearn convention is to expose both signed and
 * unsigned forms.)
 */

export { calibrationWithinGroups } from './calibration-within-groups.js';
export { demographicParity } from './demographic-parity.js';
export { disparateImpact } from './disparate-impact.js';
export { equalOpportunity } from './equal-opportunity.js';
export { equalizedOdds } from './equalized-odds.js';
export { falseDiscoveryRateParity } from './false-discovery-rate.js';
export { falseOmissionRateParity } from './false-omission-rate.js';
export { predictiveParity } from './predictive-parity.js';
export { statisticalParityDifference } from './statistical-parity-difference.js';

export { DEFAULT_THRESHOLDS, thresholdFor } from './thresholds.js';
export type { GroupCounts } from './helpers.js';
export {
  countByGroup,
  falseDiscoveryRate,
  falseOmissionRate,
  falsePositiveRate,
  positivePredictiveValue,
  selectionRate,
  truePositiveRate,
} from './helpers.js';
