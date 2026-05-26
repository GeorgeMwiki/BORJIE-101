/**
 * `@borjie/calibration-monitor` — public surface (Wave 18BB-gap).
 *
 * Continuous calibration loop over Mr. Mwikila's Tier-1+ predictions.
 * Spec: `Docs/DESIGN/CALIBRATION_INTERPRETABILITY_SPEC.md`.
 *
 * Three primitives form the API:
 *
 *   - metrics              — Brier score, ECE, reliability diagram
 *                            (pure, no I/O).
 *   - collection           — `observation-recorder` + `outcome-resolver`
 *                            (host-wired repo + audit chain).
 *   - reporting + storage  — `weekly-report-generator` rolls up the
 *                            observe → resolve stream into one
 *                            `CalibrationReport` per (tenant, kind).
 *
 * Every write traverses the host-wired `AuditChainPort`. There is
 * no out-of-band write path. Closes founder directive P0 #5.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export {
  ECE_DEFAULT_BIN_COUNT,
  ECE_SOFT_PAUSE_THRESHOLD,
  REPORT_PERIOD_DAYS,
  type CalibrationObservation,
  type CalibrationReport,
  type ReliabilityBin,
  type CalibrationWriteContext,
  type ObservationInsert,
  type OutcomeResolutionInput,
  type ObservationRepository,
  type ReportRepository,
  type AuditChainPort,
  type CalibrationErrorCode,
  CalibrationMonitorError,
  observationInsertSchema,
  outcomeResolutionSchema,
} from './types.js';

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
export {
  computeMeanBrierScore,
  pointwiseBrier,
  type CalibrationPoint,
} from './metrics/brier-score.js';
export {
  computeReliabilityDiagram,
  type ReliabilityDiagramOptions,
} from './metrics/reliability-diagram.js';
export {
  computeEce,
  eceFromDiagram,
  type EceOptions,
} from './metrics/expected-calibration-error.js';

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------
export {
  createObservationRecorder,
  type ObservationRecorderDeps,
  type ObservationRecorderFn,
} from './collection/observation-recorder.js';
export {
  createOutcomeResolver,
  type OutcomeResolverDeps,
  type OutcomeResolverFn,
} from './collection/outcome-resolver.js';

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
export {
  createWeeklyReportGenerator,
  type WeeklyReportGeneratorDeps,
  type WeeklyReportGenerateInput,
  type WeeklyReportGenerateFn,
} from './reporting/weekly-report-generator.js';

// ---------------------------------------------------------------------------
// Storage (in-memory reference impls)
// ---------------------------------------------------------------------------
export { createInMemoryObservationRepository } from './storage/observation-repository.js';
export { createInMemoryReportRepository } from './storage/report-repository.js';

// ---------------------------------------------------------------------------
// Audit chain (in-memory reference impl for tests)
// ---------------------------------------------------------------------------
export {
  createInMemoryAuditChain,
  type InMemoryAuditChain,
} from './audit/audit-chain-link.js';
