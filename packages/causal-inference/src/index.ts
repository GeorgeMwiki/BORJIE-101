/**
 * `@borjie/causal-inference` — public surface.
 *
 * SOTA-CAUSAL. Four-step causal-inference pipeline (model -> identify
 * -> estimate -> refute) for Mr. Mwikila's mining-domain questions:
 * "did the new royalty rate cause filing delays?", "if we change
 * shift schedule does safety improve?", "did fuel-price moves cause
 * production drops?", "would the incident still have happened if
 * Supervisor Mbembe had been on duty?".
 *
 * Pure-TS implementations of Granger causality, Pearl back-door and
 * front-door identification, differences-in-differences, synthetic
 * control, regression discontinuity, twin-network counterfactuals,
 * and refutation routines (placebo, bootstrap, E-value). PCMCI+
 * (tigramite) and DoWhy estimators sit behind an injected Python
 * sidecar port; offline consumers degrade gracefully to pure-TS
 * alternatives.
 *
 * Spec: Docs/DESIGN/CAUSAL_INFERENCE_SOTA_2026.md.
 * Persona: Mr. Mwikila. Brand: Borjie.
 *
 * @module @borjie/causal-inference
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  CausalEdge,
  CausalErrorCode,
  CausalGraph,
  CausalRunInsert,
  CausalRunRecord,
  CausalRunRepository,
  Counterfactual,
  IdentificationStrategy,
  PCMCIResult,
  PythonSidecarPort,
  PythonSidecarRequest,
  PythonSidecarResponse,
  RefutationReport,
  TreatmentEffect,
} from './types.js';

export {
  CAUSAL_ERROR_CODES,
  CausalInferenceError,
  IDENTIFICATION_STRATEGIES,
} from './types.js';

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export {
  fDistributionUpperTail,
  grangerCausality,
  type GrangerOptions,
  type GrangerResult,
} from './discovery/granger-causality.js';

export {
  runPcmciPlus,
  type PcmciPlusOptions,
  type PcmciPlusRequest,
} from './discovery/pcmci-plus-port.js';

// ---------------------------------------------------------------------------
// Identification
// ---------------------------------------------------------------------------

export {
  findBackdoorAdjustmentSet,
  isAdmissibleBackdoorSet,
  type BackdoorResult,
} from './identify/backdoor-criterion.js';

export {
  findFrontdoorMediatorSet,
  isFrontdoorMediatorSet,
  type FrontdoorResult,
} from './identify/frontdoor-criterion.js';

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

export {
  differencesInDifferences,
  inverseStandardNormalCdf,
  type DiDObservation,
  type DiDOptions,
} from './estimate/diff-in-diff.js';

export {
  projectOntoSimplex,
  syntheticControl,
  type SyntheticControlInput,
  type SyntheticControlOptions,
  type SyntheticControlResult,
} from './estimate/synthetic-control.js';

export {
  regressionDiscontinuity,
  type RdObservation,
  type RdOptions,
} from './estimate/regression-discontinuity.js';

export {
  runDowhyAte,
  type DowhyEstimateRequest,
} from './estimate/dowhy-port.js';

// ---------------------------------------------------------------------------
// Counterfactual
// ---------------------------------------------------------------------------

export {
  twinNetworkCounterfactual,
  type CounterfactualQuery,
  type StructuralCausalModel,
  type StructuralEquation,
} from './counterfactual/twin-network.js';

// ---------------------------------------------------------------------------
// Refutation
// ---------------------------------------------------------------------------

export {
  placeboRefutation,
  type PlaceboObservation,
  type PlaceboOptions,
  type PlaceboReport,
} from './refute/placebo.js';

export {
  bootstrap,
  type BootstrapOptions,
  type BootstrapResult,
} from './refute/bootstrap.js';

export {
  eValueSensitivity,
  type SensitivityInput,
  type SensitivityReport,
} from './refute/sensitivity.js';

export { mulberry32 } from './refute/prng.js';

// ---------------------------------------------------------------------------
// Mining domain (Mr. Mwikila)
// ---------------------------------------------------------------------------

export {
  fuelPriceImpact,
  royaltyRateImpact,
  shiftScheduleImpact,
  supervisorAssignmentImpact,
  type FuelPriceImpactInput,
  type MiningCausalRunSummary,
  type RoyaltyRateImpactInput,
  type ShiftScheduleImpactInput,
  type SupervisorAssignmentImpactInput,
} from './domain/mining-causal.js';

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export {
  createInMemoryCausalRunRepository,
  createSqlCausalRunRepository,
  type InMemoryCausalRunRepoDeps,
  type SqlCausalRunDriver,
  type SqlCausalRunRepoDeps,
} from './repositories/causal-run-repository.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export {
  buildCausalLogger,
  type CausalLoggerOptions,
} from './logger.js';
