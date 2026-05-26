/**
 * Calibration Monitor — public type surface (Wave 18BB-gap).
 *
 * Companion to `Docs/DESIGN/CALIBRATION_INTERPRETABILITY_SPEC.md`.
 * Every record below is immutable — the observe → resolve → aggregate
 * pipeline never mutates rows in place; transitions produce new
 * projections (this mirrors the immutability discipline used across
 * the Borjie codebase).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------

/**
 * Number of reliability-diagram bins used to compute ECE.
 *
 * Fixed at 10 by anti-pattern rule §6.2 of the spec ("Bin-tuning").
 * Per-tenant overrides exist for research only and require explicit
 * justification.
 */
export const ECE_DEFAULT_BIN_COUNT = 10;

/** Default cadence (days) for `weekly-report-generator`. */
export const REPORT_PERIOD_DAYS = 7;

/**
 * ECE threshold above which a `prediction_kind` is soft-paused per
 * §3.3 of the spec. Centralised here so governance reads a single
 * constant.
 */
export const ECE_SOFT_PAUSE_THRESHOLD = 0.1;

// ---------------------------------------------------------------------------
// Domain records
// ---------------------------------------------------------------------------

/**
 * One row at decision time. The `outcome_*` columns are filled in
 * later by the resolver. Once `resolved_at` is set, the row is
 * effectively frozen — re-resolution is rejected.
 */
export interface CalibrationObservation {
  readonly id: string;
  readonly tenant_id: string;
  readonly prediction_kind: string;
  readonly entity_id: string;
  readonly predicted_confidence: number;
  readonly predicted_label: string;
  readonly outcome_label: string | null;
  readonly outcome_value: 0 | 1 | null;
  readonly resolved_at: string | null;
  readonly created_at: string;
  readonly audit_hash: string;
}

/** Single row of a `K × 3` reliability diagram. */
export interface ReliabilityBin {
  readonly bin_lower: number;
  readonly bin_upper: number;
  readonly sample_count: number;
  readonly mean_confidence: number;
  readonly mean_accuracy: number;
}

/**
 * One weekly aggregate per `(tenant_id, prediction_kind, period)`.
 * Generated on cron; never mutated.
 */
export interface CalibrationReport {
  readonly id: string;
  readonly tenant_id: string;
  readonly prediction_kind: string;
  readonly report_period_start: string;
  readonly report_period_end: string;
  readonly sample_size: number;
  readonly brier_score: number;
  readonly ece: number;
  readonly reliability_diagram: ReadonlyArray<ReliabilityBin>;
  readonly generated_at: string;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Operation contexts
// ---------------------------------------------------------------------------

export interface CalibrationWriteContext {
  readonly tenant_id: string;
  readonly now: () => Date;
}

export interface ObservationInsert {
  readonly prediction_kind: string;
  readonly entity_id: string;
  readonly predicted_confidence: number;
  readonly predicted_label: string;
}

export interface OutcomeResolutionInput {
  readonly prediction_kind: string;
  readonly entity_id: string;
  readonly outcome_label: string;
  readonly outcome_value: 0 | 1;
}

// ---------------------------------------------------------------------------
// Repository ports — host wires in production adapters
// ---------------------------------------------------------------------------

export interface ObservationRepository {
  insert(row: CalibrationObservation): Promise<void>;
  findByEntity(
    tenant_id: string,
    prediction_kind: string,
    entity_id: string,
  ): Promise<CalibrationObservation | null>;
  resolve(
    tenant_id: string,
    prediction_kind: string,
    entity_id: string,
    outcome_label: string,
    outcome_value: 0 | 1,
    resolved_at: string,
  ): Promise<CalibrationObservation>;
  /**
   * Return every observation that was *resolved* within the half-open
   * window `[from, to)`, scoped to one tenant and prediction_kind.
   */
  findResolvedInWindow(
    tenant_id: string,
    prediction_kind: string,
    from: string,
    to: string,
  ): Promise<ReadonlyArray<CalibrationObservation>>;
}

export interface ReportRepository {
  insert(row: CalibrationReport): Promise<void>;
  findLatest(
    tenant_id: string,
    prediction_kind: string,
  ): Promise<CalibrationReport | null>;
}

/**
 * Audit chain port — every observation insert + resolution +
 * weekly-report emit appends a row. Production wires
 * `@borjie/audit-hash-chain`; tests use an in-memory link.
 */
export interface AuditChainPort {
  append(payload: {
    readonly tenant_id: string;
    readonly event_kind: string;
    readonly entity_id: string;
    readonly recorded_at: string;
    readonly payload_digest: string;
  }): Promise<string>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type CalibrationErrorCode =
  | 'MISSING_TENANT'
  | 'INVALID_CONFIDENCE'
  | 'INVALID_INPUT'
  | 'DUPLICATE_OBSERVATION'
  | 'RESOLUTION_CONFLICT'
  | 'OBSERVATION_NOT_FOUND'
  | 'EMPTY_DATASET';

export class CalibrationMonitorError extends Error {
  public readonly code: CalibrationErrorCode;

  public constructor(message: string, code: CalibrationErrorCode) {
    super(message);
    this.name = 'CalibrationMonitorError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Zod schemas (mirror the immutable types above)
// ---------------------------------------------------------------------------

export const observationInsertSchema = z.object({
  prediction_kind: z.string().min(1),
  entity_id: z.string().min(1),
  predicted_confidence: z.number().min(0).max(1),
  predicted_label: z.string().min(1),
});

export const outcomeResolutionSchema = z.object({
  prediction_kind: z.string().min(1),
  entity_id: z.string().min(1),
  outcome_label: z.string().min(1),
  outcome_value: z.union([z.literal(0), z.literal(1)]),
});
