/**
 * Motivational subsystem types — the organ behind "loops the user has no idea
 * about" (Wave 1; CLARION Motivational Subsystem; BDI maintenance goals;
 * `Docs/research/MD_COGNITIVE_KERNEL_ARCHITECTURE.md` §5.1).
 *
 * A veteran MD holds a small set of STANDING CONCERNS (cash never breaks, the
 * licence never lapses, the workforce is safe, off-take is covered, royalty is
 * current, equipment is healthy) and continuously asks of the world: "am I
 * moving toward or away from a concern, and by how much?" An UNSATISFIED
 * concern GENERATES a goal with NO incoming trigger — that is the structural
 * difference between a resident mind and a request/response assistant.
 *
 * This module is PURE: a drive is data + a satisfaction evaluator over the
 * situational snapshot. It NEVER acts — it only emits a `DriveSignal` that the
 * EstateMind loop turns into a gated PROPOSAL. Money/licence/deletion stay
 * HITL; a drive can RAISE a concern about them but can never close the loop.
 */

import type { ActivatedEntity, SituationalSnapshot } from '../situational-model/types.js';

/** The standing estate drives. Domain-agnostic organ, mining drive pack. */
export const DRIVE_IDS = [
  'cash-runway',
  'licence-currency',
  'safety',
  'offtake-coverage',
  'royalty-currency',
  'equipment-health',
] as const;

export type DriveId = (typeof DRIVE_IDS)[number];

/** How urgently an unsatisfied drive wants attention. Maps to goal priority. */
export type DriveUrgency = 'low' | 'medium' | 'high' | 'critical';

/**
 * Per-tenant drive configuration. Thresholds are tenant-tunable so an estate
 * can set its own risk appetite (a 30-day cash floor for one, 60 for another)
 * — NEVER hard-coded at a call site. Omitted thresholds fall back to the
 * built-in defaults in `default-drives.ts`.
 */
export interface DriveThresholds {
  readonly cashRunwayDaysFloor?: number;
  readonly licenceRenewalDaysFloor?: number;
  readonly safetyOpenIncidentsCeiling?: number;
  readonly offtakeCoverageRatioFloor?: number;
  readonly royaltyOverdueDaysCeiling?: number;
  readonly equipmentHealthScoreFloor?: number;
}

/**
 * The result of evaluating one drive against the current situational snapshot.
 * `satisfied=false` means the standing concern is breached → a goal should be
 * formulated. The `evidence` is the activated entities that triggered the
 * breach (carried into the proposal so the Auditor's evidence-required rail is
 * honoured downstream — every recommendation cites ≥1 source).
 */
export interface DriveAssessment {
  readonly driveId: DriveId;
  readonly satisfied: boolean;
  /** [0,1] — how far from satisfaction (0 = fine, 1 = maximally breached). */
  readonly breachSeverity: number;
  readonly urgency: DriveUrgency;
  /** One-line, locale-free summary of the concern (the loop localises). */
  readonly summary: string;
  /** The entities that evidence the breach (empty when satisfied). */
  readonly evidence: ReadonlyArray<ActivatedEntity>;
}

/**
 * A drive: a standing concern + a PURE evaluator. The evaluator reads the
 * snapshot + thresholds and returns an assessment. It must be total (never
 * throw) and deterministic — same snapshot → same assessment.
 */
export interface Drive {
  readonly id: DriveId;
  /** Locale-free human description (logs / proposal context). */
  readonly description: string;
  evaluate(
    snapshot: SituationalSnapshot,
    thresholds: DriveThresholds,
  ): DriveAssessment;
}

/**
 * A goal the motivation organ formulates from an unsatisfied drive. This is a
 * PROPOSAL seed only — it carries no executable tool steps for sovereign
 * actions; the EstateMind loop maps it to a gated nudge. The shape is
 * deliberately minimal + domain-free.
 */
export interface MotivatedGoal {
  readonly tenantId: string;
  /** Stable dedupe id: `drive:${driveId}` so the same concern coalesces. */
  readonly id: string;
  readonly driveId: DriveId;
  readonly title: string;
  readonly rationale: string;
  readonly urgency: DriveUrgency;
  readonly breachSeverity: number;
  readonly evidence: ReadonlyArray<ActivatedEntity>;
  readonly formulatedAtMs: number;
}
