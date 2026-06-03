/**
 * Cross-document reconciliation stage (LP-26 wiring).
 *
 * The quality gates in `../quality-gates` judge ONE artifact at a time
 * (confidence, schema, citations, …). But a mining matter usually arrives
 * as a *batch* — NIDA + TIN + mining licence + royalty receipt — and the
 * decisive quality signal is whether those documents agree with one another
 * (same person, same id, same amounts). That cross-document check lives in
 * `@borjie/document-reconciliation`; this stage is the seam that runs it and
 * folds its verdict back into the package's existing `QualityReport`
 * vocabulary so a service can treat it like any other gate result.
 *
 * Design contract:
 *   - ADDITIVE. It never replaces a per-document gate; it augments the batch.
 *   - FAIL-SAFE. Any error inside reconciliation degrades to a `notReconciled`
 *     report (passed=true, so it can never *block* a batch on its own bug) —
 *     it NEVER throws. Reconciliation is advisory hardening, not a tripwire
 *     that takes the pipeline down.
 *   - PURE-ISH. No I/O, no SDK. Callers pass already-extracted documents.
 *
 * Two optional pre-passes are exposed for pipelines that produce multiple
 * extractions of the same document:
 *   - {@link voteExtractionShots} — self-consistency vote across N shots,
 *     collapsing them to one merged extraction + per-field disagreement flags.
 *   - {@link calibrateFieldConfidence} — per-field-type Platt calibration so a
 *     raw model score becomes a trustworthy probability before it weights a
 *     match.
 *
 * @module @borjie/document-quality-guarantor/reconciliation
 */

import {
  buildFactBags,
  reconcileDocBatch,
  voteOnFields,
  calibrate,
  DEFAULT_CALIBRATION_TABLE,
  type ExtractionForReconciliation,
  type ReconciliationReport,
  type Blocker,
  type SoftFlag,
  type VoteResult,
  type ExtractedFieldLike,
  type CalibrationTable,
} from '@borjie/document-reconciliation';

import type { QualityReport } from '../types.js';

/** Stable gate id so audit + compose treat this like every other gate. */
export const RECONCILIATION_GATE_ID = 'crossDocumentReconciliation';

/**
 * Default minimum criticality-weighted consistency for a batch to PASS.
 * Below this, the report is marked `passed=false` so the caller can route
 * the batch to escalation — mirrors the `*_GATE` threshold convention.
 */
export const DEFAULT_MIN_BATCH_CONSISTENCY = 0.75;

export interface ReconciliationStageOptions {
  /**
   * Consistency floor in [0,1]; default {@link DEFAULT_MIN_BATCH_CONSISTENCY}.
   * The stage still always fails (passed=false) when blockers are present,
   * independent of this threshold.
   */
  readonly minConsistency?: number;
}

export interface ReconciliationStageInput {
  /**
   * The batch of extracted documents for one matter, projected to the
   * reconciler's minimal shape (documentId + docType + fields). Use
   * {@link toExtractionForReconciliation} adapters at the host, or build the
   * shape directly from your persisted extraction rows.
   */
  readonly extractions: readonly ExtractionForReconciliation[];
  readonly options?: ReconciliationStageOptions;
}

export interface ReconciliationStageResult {
  /** Quality-gate-shaped verdict — slots into the existing gate vocabulary. */
  readonly report: QualityReport;
  /**
   * The structured cross-document report when reconciliation ran, else
   * undefined (degraded path). Lets a UI render the full mismatch detail.
   */
  readonly reconciliation?: ReconciliationReport;
  /** True when reconciliation actually ran; false on the fail-safe path. */
  readonly reconciled: boolean;
  /** Surfaced blockers — empty on the degraded path. */
  readonly blockers: readonly Blocker[];
  /** Surfaced soft flags — empty on the degraded path. */
  readonly softFlags: readonly SoftFlag[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function blockerReason(blocker: Blocker): string {
  return `BLOCKER[${blocker.field}] ${blocker.explanation} (docs: ${blocker.involvedDocIds.join(', ')})`;
}

function softFlagReason(flag: SoftFlag): string {
  return `SOFT_FLAG[${flag.field}] ${flag.explanation} (docs: ${flag.involvedDocIds.join(', ')})`;
}

/**
 * The fail-safe verdict used whenever reconciliation cannot run or throws.
 * passed=true so a reconciliation fault can never, by itself, block a batch —
 * it only ever *adds* a STRICT verdict, never manufactures one from a bug.
 */
function notReconciledReport(reasons: readonly string[]): QualityReport {
  return {
    gateId: RECONCILIATION_GATE_ID,
    score: { value: 1, threshold: 0, passed: true },
    reasons,
    details: { reconciled: false },
  };
}

/**
 * Run cross-document reconciliation over a batch of extracted documents and
 * fold the verdict into a {@link QualityReport}. Never throws.
 *
 * Verdict rules:
 *   - 0 or 1 reconcilable documents → nothing to cross-check → PASS, reconciled.
 *   - Any STRICT blocker → FAIL (different person / id / amount across docs).
 *   - No blockers but consistency below threshold → FAIL (soft drift).
 *   - Otherwise → PASS, with any soft flags surfaced as reasons.
 */
export function runReconciliationStage(
  input: ReconciliationStageInput,
): ReconciliationStageResult {
  const minConsistency = clamp01(
    input.options?.minConsistency ?? DEFAULT_MIN_BATCH_CONSISTENCY,
  );

  try {
    const factBags = buildFactBags(input.extractions);
    const reconciliation = reconcileDocBatch(factBags);

    const { blockers, softFlags, overallConsistency } = reconciliation;
    const hasBlocker = blockers.length > 0;
    const meetsConsistency = overallConsistency >= minConsistency;
    const passed = !hasBlocker && meetsConsistency;

    const reasons: string[] = [
      `reconciled ${factBags.length} document(s); consistency ${overallConsistency.toFixed(3)} vs threshold ${minConsistency}`,
      ...blockers.map(blockerReason),
      ...softFlags.map(softFlagReason),
    ];

    return {
      report: {
        gateId: RECONCILIATION_GATE_ID,
        score: {
          value: clamp01(overallConsistency),
          threshold: minConsistency,
          passed,
        },
        reasons,
        details: {
          reconciled: true,
          documentsCompared: factBags.length,
          mismatches: reconciliation.mismatches.length,
          matches: reconciliation.matches.length,
          blockers,
          softFlags,
        },
      },
      reconciliation,
      reconciled: true,
      blockers,
      softFlags,
    };
  } catch (error) {
    // Fail-safe: reconciliation is advisory hardening. A fault here degrades
    // to "not reconciled" — it must never throw into the pipeline nor block a
    // batch on its own bug.
    const message = error instanceof Error ? error.message : String(error);
    return {
      report: notReconciledReport([
        `reconciliation skipped (degraded): ${message}`,
      ]),
      reconciled: false,
      blockers: [],
      softFlags: [],
    };
  }
}

/**
 * Self-consistency pre-pass for pipelines that extract the same document
 * multiple times (e.g. several OCR/LLM shots). Collapses the shots to one
 * merged extraction and flags per-field disagreement. Never throws — on any
 * fault it returns the first shot unchanged with empty votes.
 */
export function voteExtractionShots(
  shots: readonly (readonly ExtractedFieldLike[])[],
  disagreementThreshold?: number,
): VoteResult {
  try {
    return disagreementThreshold === undefined
      ? voteOnFields(shots)
      : voteOnFields(shots, disagreementThreshold);
  } catch {
    return { merged: shots[0] ?? [], votes: [] };
  }
}

/**
 * Per-field-type confidence calibration. Converts a raw extractor score into
 * a calibrated probability before it is used to weight a match. Never throws —
 * on any fault it returns the raw score unchanged (identity calibration).
 */
export function calibrateFieldConfidence(
  rawScore: number,
  fieldType: string,
  table: CalibrationTable = DEFAULT_CALIBRATION_TABLE,
): number {
  try {
    return calibrate(rawScore, fieldType, table);
  } catch {
    return rawScore;
  }
}
