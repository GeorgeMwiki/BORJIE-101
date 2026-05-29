/**
 * `@borjie/intel-self-improve` — public surface (Wave INTEL-SELF-IMPROVE).
 *
 * Persona: **Mr. Mwikila** — Borjie's autonomous Managing Director for
 * Tanzanian mining operators. Companion spec:
 * Docs/DESIGN/INTELLIGENCE_SELF_IMPROVE_WIRING_2026.md.
 *
 * Eight concerns exposed:
 *
 *   - types               — MeasuredCapability + IntelInvocationContext +
 *                           OutcomeObservation + IntelKind enumeration.
 *   - wrap                — `wrapAsMeasured` higher-order wrapper that
 *                           emits to intel_invocation_audit +
 *                           capability_invocations + intel_skill_traces.
 *   - verifiers           — 6 RLVR builtins (forecast / stat / graph /
 *                           causal / anomaly / recommendation).
 *   - measurers           — per-kind ground-truth measurers that reduce
 *                           raw observations to competence + calibration
 *                           + utility axes (capability-catalogue scoring).
 *   - observe             — outcome-observer cron worker that attaches
 *                           ground truth to pending audit rows.
 *   - curate              — intel-trace curator that shapes training pairs
 *                           for the meta-learning conductor.
 *   - repositories        — port + in-memory + SQL adapters for the two
 *                           tenant-scoped tables backing migration 0072.
 *
 * @module @borjie/intel-self-improve
 */

// ── Types ─────────────────────────────────────────────────────────────
export {
  INTEL_KINDS,
  IntelInvocationContextSchema,
  IntelSkillTraceSchema,
  IntelSelfImproveError,
  OutcomeObservationSchema,
  type IntelInvocationContext,
  type IntelKind,
  type IntelSelfImproveErrorCode,
  type IntelSkillTrace,
  type MeasuredCapability,
  type OutcomeObservation,
} from './types.js';

// ── Wrap ──────────────────────────────────────────────────────────────
export {
  buildMeasuredCapability,
  emitTelemetry,
  patternSignatureFor,
  RANDOM_UUID_GEN,
  SYSTEM_CLOCK,
  wrapAsMeasured,
  type Clock,
  type EmitTelemetryArgs,
  type IdGen,
  type WrapAsMeasuredDeps,
} from './wrap/wrap-as-measured.js';

// ── Verifiers ─────────────────────────────────────────────────────────
export {
  createAllIntelVerifiers,
  createAnomalyPrecisionRecallVerifier,
  createCausalRefutationStableVerifier,
  createForecastIntervalCoverageVerifier,
  createGraphQueryNonEmptyVerifier,
  createIntelBuiltinVerifiers,
  createRecommendationHitRateVerifier,
  createStatResultShapeVerifier,
  type AnomalyPrecisionRecallInputs,
  type CausalRefutationInputs,
  type ForecastIntervalCoverageInputs,
  type ForecastSingleIntervalInputs,
  type GraphQueryNonEmptyInputs,
  type RecommendationHitCountInputs,
  type RecommendationHitRateInputs,
  type StatResultShapeInputs,
} from './verifiers/intel-builtins.js';

// ── Measurers ─────────────────────────────────────────────────────────
export {
  measureForecast,
  measureForecasts,
  summariseForecastCohort,
  type ForecastCohortSummary,
  type ForecastMeasurement,
  type ForecastMeasurementInput,
  type ForecastMeasurementResult,
  type ForecastObservation,
} from './measure/forecast-measurer.js';
export {
  measureAnomalies,
  measureAnomaly,
  type AnomalyMeasurement,
  type AnomalyMeasurementInput,
  type AnomalyMeasurementResult,
  type AnomalyObservation,
} from './measure/anomaly-measurer.js';
export {
  measureRecommendation,
  measureRecommendations,
  summariseRecommendationCohort,
  type RecommendationCohortSummary,
  type RecommendationMeasurement,
  type RecommendationMeasurementInput,
  type RecommendationMeasurementResult,
  type RecommendationObservation,
} from './measure/recommendation-measurer.js';

// ── Observe ───────────────────────────────────────────────────────────
export {
  runOutcomeObserverTick,
  type OutcomeFeedPort,
  type OutcomeFeedSnapshot,
  type OutcomeObserverConfig,
  type OutcomeObserverDeps,
  type OutcomeObserverTickResult,
} from './observe/outcome-observer.js';

// ── Curate ────────────────────────────────────────────────────────────
export {
  curateIntelTrainingPairs,
  DEFAULT_INTEL_CURATOR_CONFIG,
  shapeIntelTrainingPair,
  type IntelCuratorConfig,
  type IntelTrainingPair,
} from './curate/intel-trace-curator.js';

// ── Repositories ──────────────────────────────────────────────────────
export {
  createInMemoryIntelInvocationAuditRepository,
  createSqlIntelInvocationAuditRepository,
  type IntelInvocationAuditRepository,
  type IntelInvocationAuditRow,
  type SqlIntelInvocationAuditDriver,
} from './repositories/intel-invocation-audit-repository.js';
export {
  createInMemoryIntelSkillTracesRepository,
  createSqlIntelSkillTracesRepository,
  type IntelSkillTracesRepository,
  type SkillTraceTickInput,
  type SqlIntelSkillTracesDriver,
} from './repositories/intel-skill-traces-repository.js';
