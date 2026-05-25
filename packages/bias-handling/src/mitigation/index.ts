/**
 * Mitigation barrel.
 *
 * Three tiers per AIF360 + Fairlearn taxonomy:
 *   - Pre-processing  → reweigh, learnedFairRepresentations
 *   - In-processing   → addFairnessConstraint, adversarialDebiasing
 *   - Post-processing → equalizedOddsPostprocess, rejectOptionClassification
 */

export type { ReweighRow, ReweighedRow } from './reweigh.js';
export { reweigh } from './reweigh.js';

export type {
  FairRepresentationConfig,
  FairRepresentationProjector,
} from './learned-fair-representations.js';
export { learnedFairRepresentations } from './learned-fair-representations.js';

export type {
  ConstrainedModelResult,
  ConstraintAdapterArgs,
  InnerTrainerInput,
} from './fairness-constraint.js';
export { addFairnessConstraint } from './fairness-constraint.js';

export type {
  AdversarialDebiasingArgs,
  AdversarialDebiasingResult,
  AdversarialPredictor,
  AdversaryNetwork,
} from './adversarial-debiasing.js';
export { adversarialDebiasing } from './adversarial-debiasing.js';

export type {
  CalibrationRow,
  EqualizedOddsPostprocessArgs,
  EqualizedOddsThresholds,
} from './equalized-odds-postprocess.js';
export { equalizedOddsPostprocess } from './equalized-odds-postprocess.js';

export type {
  RejectOptionConfig,
  RejectOptionInput,
} from './reject-option-classification.js';
export { rejectOptionClassification } from './reject-option-classification.js';

export { MITIGATION_STRATEGIES } from './strategies.js';
