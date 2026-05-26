/**
 * `@borjie/capability-catalogue` — public surface (Wave CAPABILITY).
 *
 * Canonical registry of every capability Mr. Mwikila can perform.
 * Spec: `Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md`.
 *
 * Five concerns exposed:
 *
 *   - types                — Capability + Invocation + Outcome + Measurement
 *                            shapes and the enumerations behind them.
 *   - registry             — port + in-memory adapter. Manages lifecycle
 *                            transitions.
 *   - seeds                — register the 5 atomic capabilities + the
 *                            compose_anything_v1 meta-dispatcher.
 *   - measurement          — pure functions for the three axes
 *                            (competence / calibration / utility) plus
 *                            an aggregator that combines them per window.
 *   - lifecycle            — the threshold-based promote/demote decision.
 *   - repositories         — in-memory + SQL adapters for the four
 *                            persistence ports.
 *
 * @module @borjie/capability-catalogue
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export {
  CAPABILITY_KINDS,
  LIFECYCLE_STATES,
  PROVENANCE_CLASSES,
  COST_CLASSES,
  OBSERVED_OUTCOMES,
  USER_FOLLOWTHROUGHS,
  MEASUREMENT_WINDOW_DAYS,
  SEED_TENANT_ID,
  CapabilityCatalogueError,
  CapabilityContractSchema,
  CapabilitySchema,
  InvocationSchema,
  OutcomeSchema,
  MeasurementSchema,
  type Capability,
  type CapabilityAuthorInput,
  type CapabilityCatalogueErrorCode,
  type CapabilityContract,
  type CapabilityKind,
  type CostClass,
  type Invocation,
  type Lifecycle,
  type Measurement,
  type MeasurementWindowDays,
  type ObservedOutcome,
  type Outcome,
  type ProvenanceClass,
  type UserFollowthrough,
} from './types.js';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export {
  createInMemoryCapabilityRegistry,
  type CapabilityRegistry,
} from './registry/registry.js';

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------
export {
  ATOMIC_CAPABILITY_SEEDS,
  ComposeCampaignInputSchema,
  ComposeCampaignOutputSchema,
  ComposeDocInputSchema,
  ComposeDocOutputSchema,
  ComposeMediaInputSchema,
  ComposeMediaOutputSchema,
  ComposeTabInputSchema,
  ComposeTabOutputSchema,
  ResearchInputSchema,
  ResearchOutputSchema,
  registerAtomicCapabilities,
} from './seeds/atomic-capabilities.js';

export {
  ComposeAnythingInputSchema,
  ComposeAnythingOutputSchema,
  ComposeAnythingPlanStepSchema,
  META_CAPABILITY_NAME,
  META_CAPABILITY_VERSION,
  registerAllSeeds,
  registerMetaCapabilities,
} from './seeds/meta-capabilities.js';

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------
export {
  computeCompetence,
  type CompetenceInput,
  type CompetenceResult,
} from './measurement/competence.js';
export {
  computeCalibration,
  type CalibrationInput,
  type CalibrationResult,
} from './measurement/calibration.js';
export {
  computeUtility,
  type UtilityInput,
  type UtilityResult,
} from './measurement/utility.js';
export {
  aggregateMeasurement,
  type AggregateInput,
} from './measurement/aggregator.js';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
export {
  DEFAULT_THRESHOLDS,
  decideLifecycle,
  type LifecycleThresholds,
  type LifecycleVerdict,
} from './lifecycle/lifecycle-manager.js';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------
export {
  createInMemoryCapabilityRepository,
  createSqlCapabilityRepository,
  type CapabilityRepository,
  type SqlCapabilityDriver,
} from './repositories/capability-repository.js';
export {
  createInMemoryInvocationRepository,
  createSqlInvocationRepository,
  type InvocationRepository,
  type SqlInvocationDriver,
} from './repositories/invocation-repository.js';
export {
  createInMemoryOutcomeRepository,
  createSqlOutcomeRepository,
  type OutcomeRepository,
  type SqlOutcomeDriver,
} from './repositories/outcome-repository.js';
export {
  createInMemoryMeasurementRepository,
  createSqlMeasurementRepository,
  type MeasurementRepository,
  type SqlMeasurementDriver,
} from './repositories/measurement-repository.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
export { buildCatalogueLogger, type CatalogueLoggerOptions } from './logger.js';
