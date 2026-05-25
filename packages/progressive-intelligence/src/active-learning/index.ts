/**
 * Public surface for active learning.
 *
 * Loop:
 *   flagUncertainCases -> requestLabel -> incorporateLabel
 *
 * For multi-oracle cohorts, detectNoisyLabels finds disagreements that
 * should be re-routed.
 */
export {
  flagUncertainCases,
  type FlagUncertainCasesArgs,
} from './uncertain.js';
export {
  requestLabel,
  incorporateLabel,
  emptyModel,
  type RequestLabelArgs,
  type IncorporateLabelArgs,
} from './label.js';
export {
  detectNoisyLabels,
  noisyLabelsToCases,
  type DetectNoiseArgs,
} from './noise.js';
