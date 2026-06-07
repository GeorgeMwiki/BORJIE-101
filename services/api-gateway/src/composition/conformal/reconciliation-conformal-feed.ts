/**
 * Reconciliation → conformal coverage feed.
 *
 * The REAL outcome side of the online-ACI loop. The closed-loop telemetry
 * system (migration 0114) is the live prediction→outcome pipeline:
 *
 *   - `outcome-predictor` brain-tool emits a prediction per brain write
 *     (`outcome_predictions`: predicted_value_tzs + prediction_confidence).
 *   - `outcome-reconciliation-worker` resolves each prediction against the
 *     observed outcome after its horizon and classifies the gap into a
 *     `status`: matched | divergent | undetermined | expired.
 *
 * That `status` IS a coverage signal: `matched` (drift < the matched band) means
 * the observed value fell inside the prediction's tolerance → COVERED; `divergent`
 * means it fell outside → NOT covered. Folding that bit through the ACI state
 * machine is what MOVES the calibrated alpha toward target coverage — so the
 * alpha the chat path consumes is learned from REAL reconciliations, not a
 * fabricated constant.
 *
 * This module is the pure mapping + the loop call. The worker invokes
 * `feedReconciliationToConformal(...)` right after it durably writes the
 * reconciliation row, inside the SAME tenant-pinned transaction so:
 *   1. RLS FORCE sees the tenant GUC on every conformal_* statement, and
 *   2. the conformal write shares the reconciliation's commit boundary.
 *
 * Coverage resolution (only `matched`/`divergent` advance alpha):
 *   - matched   → covered = true
 *   - divergent → covered = false
 *   - undetermined / expired → SKIPPED (no clean observation; the loop must not
 *     learn from a non-observation). Returns `null`.
 *
 * The conformal prediction-type is the prediction's `action_kind` (e.g.
 * `licence.renew`, `royalty.assess`) namespaced under `action:` so each action
 * family calibrates its own alpha, kept distinct from the chat-turn alpha
 * (`chat_turn_confidence`). The conformal `predictionId` reuses the
 * `outcome_predictions.id` so the prediction and its outcome are 1:1.
 *
 * Idempotent + fail-soft: the store upserts the prediction and no-ops a
 * duplicate observation; any failure is swallowed (the optional Pino warn sink
 * records it) so a calibration write NEVER fails the reconciliation it follows.
 * No `console.log`.
 */

import { createDrizzleConformalStore } from './drizzle-conformal-store.js';
import {
  createConformalCalibrationLoop,
  type ConformalLoopLogger,
} from './conformal-calibration-loop.js';

/** Reconciliation verdicts that carry a usable coverage bit. */
export type ReconciliationCoverageStatus = 'matched' | 'divergent';

export interface ReconciliationConformalInput {
  readonly tenantId: string;
  /** `outcome_predictions.id` — reused as the conformal prediction id (1:1). */
  readonly predictionId: string;
  /** The prediction's `action_kind` — namespaced into the conformal type. */
  readonly actionKind: string;
  /** Reconciliation verdict; only matched/divergent advance the loop. */
  readonly status: 'matched' | 'divergent' | 'undetermined' | 'expired';
  /** Predicted scalar (TZS) when a monetary forecast was made. */
  readonly predictedValueTzs: number | null;
  /** Observed scalar (TZS) from the resolver, when available. */
  readonly observedValueTzs: number | null;
  /** Drift score the worker computed (0..1). Recorded for the audit trail. */
  readonly driftScore: number;
  /** ISO timestamp the outcome was reconciled. */
  readonly reconciledAtIso?: string;
}

/**
 * Build the conformal prediction-type slug for a reconciled action prediction.
 * Namespaced so it can never collide with the chat-turn type. Lower-cased and
 * sanitised to the route's slug grammar (`[a-z0-9_.:-]`).
 */
export function conformalTypeForAction(actionKind: string): string {
  const safe = actionKind
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .slice(0, 100);
  return `action:${safe.length > 0 ? safe : 'unknown'}`;
}

/** matched → covered; divergent → not covered. */
function statusToCovered(status: ReconciliationCoverageStatus): boolean {
  return status === 'matched';
}

/**
 * Fold a finalized reconciliation into the conformal loop. `db` MUST be the
 * tenant-pinned transaction handle from the worker's `withWorkerTenantContext`
 * (so RLS fires). Returns the new alpha when the loop advanced, or `null` when
 * the verdict carried no usable coverage bit (undetermined/expired) or the
 * write failed.
 */
export async function feedReconciliationToConformal(
  db: unknown,
  input: ReconciliationConformalInput,
  logger?: ConformalLoopLogger,
): Promise<{ alpha: number } | null> {
  // Only matched/divergent are real coverage observations. Skip the rest so the
  // loop never learns from a non-observation.
  if (input.status !== 'matched' && input.status !== 'divergent') {
    return null;
  }
  if (!db) return null;

  const predictionType = conformalTypeForAction(input.actionKind);
  const covered = statusToCovered(input.status);
  const observedAtIso = input.reconciledAtIso ?? new Date().toISOString();

  // Derive the prediction interval from the predicted scalar + the matched
  // drift band so a later coverage judgement has an interval recorded. The
  // band mirrors the worker's `MATCHED_DRIFT_BAND` semantics (a ±band envelope
  // around the predicted value). When no scalar was predicted we still enroll
  // the prediction (value/interval omitted) — the coverage bit comes from the
  // worker's vector-drift classification, not the recorded interval.
  const MATCHED_BAND = 0.15;
  const interval =
    input.predictedValueTzs !== null
      ? {
          predictedValue: input.predictedValueTzs,
          predictedLower: input.predictedValueTzs * (1 - MATCHED_BAND),
          predictedUpper: input.predictedValueTzs * (1 + MATCHED_BAND),
        }
      : {};

  const loop = createConformalCalibrationLoop({
    // The worker's `tx` is a full Drizzle client at runtime (the store needs the
    // query builder); the worker only narrows it to `{ execute }` for its raw
    // SQL. The store's seam is `any`, so this cast is the same one the route uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store: createDrizzleConformalStore(db as any),
    ...(logger ? { logger } : {}),
  });

  try {
    // 1. Enroll (or refresh) the prediction with the alpha in force at outcome
    //    time + its interval. Idempotent upsert keyed on (tenant, predictionId).
    await loop.recordPrediction({
      tenantId: input.tenantId,
      predictionId: input.predictionId,
      predictionType,
      ...interval,
      metadata: {
        source: 'outcome-reconciliation',
        actionKind: input.actionKind,
        driftScore: input.driftScore,
      },
      createdBy: 'reconciler',
    });

    // 2. Record the coverage outcome — this advances the ACI alpha.
    return await loop.recordOutcome({
      tenantId: input.tenantId,
      predictionId: input.predictionId,
      predictionType,
      ...(input.observedValueTzs !== null
        ? { observedValue: input.observedValueTzs }
        : {}),
      covered,
      observedAtIso,
      metadata: {
        source: 'outcome-reconciliation',
        status: input.status,
        driftScore: input.driftScore,
      },
      createdBy: 'reconciler',
    });
  } catch (err) {
    logger?.warn(
      {
        feed: 'reconciliation-conformal',
        predictionType,
        error: err instanceof Error ? err.message : String(err),
      },
      'reconciliation-conformal: feed failed; alpha not advanced',
    );
    return null;
  }
}
