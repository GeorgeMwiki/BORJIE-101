/**
 * `@borjie/bias-handling` — public surface.
 *
 * Sister to `@borjie/fairness-eval`:
 *  - fairness-eval = individual / counterfactual fairness.
 *  - bias-handling = group fairness + mitigation + LLM bias +
 *    drift + subgroup discovery + anti-discrimination law map.
 *
 * Background + citations: `Docs/BIAS_HANDLING_SOTA_2026-05-25.md`.
 */

export type {
  BiasDriftAlert,
  BiasDriftObservation,
  BiasBrain,
  BiasMetric,
  DisparityScore,
  FairnessConstraint,
  FairnessRow,
  Jurisdiction,
  LLMBiasBenchmark,
  MitigationStrategy,
  MitigationTier,
  ProtectedAttribute,
  ProtectionContext,
  SliceFinderRow,
  SubgroupSlice,
} from './types.js';

// 8 group-fairness metrics
export {
  DEFAULT_THRESHOLDS,
  calibrationWithinGroups,
  countByGroup,
  demographicParity,
  disparateImpact,
  equalOpportunity,
  equalizedOdds,
  falseDiscoveryRate,
  falseDiscoveryRateParity,
  falseOmissionRate,
  falseOmissionRateParity,
  falsePositiveRate,
  positivePredictiveValue,
  predictiveParity,
  selectionRate,
  statisticalParityDifference,
  thresholdFor,
  truePositiveRate,
} from './group-fairness-metrics/index.js';

export type { GroupCounts } from './group-fairness-metrics/index.js';

// Mitigation — 3 tiers
export {
  MITIGATION_STRATEGIES,
  addFairnessConstraint,
  adversarialDebiasing,
  equalizedOddsPostprocess,
  learnedFairRepresentations,
  rejectOptionClassification,
  reweigh,
} from './mitigation/index.js';
export type {
  AdversarialDebiasingArgs,
  AdversarialDebiasingResult,
  AdversarialPredictor,
  AdversaryNetwork,
  CalibrationRow,
  ConstrainedModelResult,
  ConstraintAdapterArgs,
  EqualizedOddsPostprocessArgs,
  EqualizedOddsThresholds,
  FairRepresentationConfig,
  FairRepresentationProjector,
  InnerTrainerInput,
  RejectOptionConfig,
  RejectOptionInput,
  ReweighRow,
  ReweighedRow,
} from './mitigation/index.js';

// Subgroup discovery — Slice Finder
export { findSlices, twoSidedBinomialPValue } from './subgroup-discovery/index.js';
export type { FindSlicesArgs } from './subgroup-discovery/index.js';

// LLM bias benchmarks
export {
  BBQ_CATEGORIES,
  BBQ_FIXTURE,
  CROWS_PAIRS_CATEGORIES,
  CROWS_PAIRS_FIXTURE,
  HONEST_CATEGORIES,
  HONEST_FIXTURE,
  RTP_CATEGORIES,
  RTP_FIXTURE,
  STEREOSET_CATEGORIES,
  STEREOSET_FIXTURE,
  containsAnyKeyword,
  parseChoiceIndex,
  runBBQ,
  runCrowSPairs,
  runHONEST,
  runRealToxicityPrompts,
  runStereoSet,
} from './llm-bias-benchmarks/index.js';
export type {
  BBQItem,
  BBQRunArgs,
  CrowSPairsItem,
  CrowSPairsRunArgs,
  HONESTRunArgs,
  HonestItem,
  RTPItem,
  RTPRunArgs,
  StereoSetItem,
  StereoSetRunArgs,
} from './llm-bias-benchmarks/index.js';

// Drift monitoring
export { BiasDriftMonitor, twoSampleKS } from './drift-monitoring/index.js';
export type { BiasDriftMonitorOptions } from './drift-monitoring/index.js';

// Anti-discrimination law map
export {
  ALL_JURISDICTIONS,
  KE_ART27_PROTECTIONS,
  PROTECTION_REGISTRY,
  TZ_ART13_PROTECTIONS,
  UK_EQUALITY_ACT_PROTECTIONS,
  US_ECOA_PROTECTIONS,
  US_FHA_PROTECTIONS,
  getApplicableProtections,
} from './anti-discrimination-laws/index.js';
export type { SupportedJurisdiction } from './anti-discrimination-laws/index.js';

// Composition factory
export { createBiasHandling } from './factory.js';
export type {
  BiasAuditSink,
  BiasHandling,
  CreateBiasHandlingArgs,
} from './factory.js';
