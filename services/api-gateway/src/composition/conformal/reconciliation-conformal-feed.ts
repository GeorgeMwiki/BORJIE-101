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
import type {
  CalibrationCurvePoint,
  CalibrationDriftEvent,
} from '../../services/calibration-monitor/index.js';
import type { estateMind } from '@borjie/central-intelligence';

type EstateProposal = estateMind.EstateProposal;
type ProposalSink = estateMind.ProposalSink;

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

// ───────────────────────────────────────────────────────────────────────────
// WIN-1 — Calibrated humility. The MD trusts itself LESS on exactly the topics
// it has recently been wrong about. Two seams, both built here:
//
//   (a) the confidence-gate — a pure metacognitive gate run BEFORE the MD states
//       a confidence on a topic. It reads the per-domain calibration curve (the
//       same `mining.calibration.score` brain-tool wraps) and, if the band the MD
//       is about to claim has historically under-landed FOR THIS action-kind,
//       down-shifts the SPOKEN confidence + prepends a one-line humility prefix.
//       Turns the existing one-shot "did your last N work?" tool into a
//       continuous gate. INV-H honest-confidence: it surfaces POSTURE (a hedge
//       line + a softened number), never the audit math.
//
//   (b) the drift→proposal bridge — binds the previously UNCONSUMED
//       `CalibrationDriftSink` to the estate-mind proposal sink, so a sustained
//       calibration dip surfaces as a gated proactive nudge ("my recent calls on
//       X have been shaky — I'm hedging there until they recover") instead of
//       evaporating. Propose-only: it writes through the existing gated sink, it
//       never actuates.
// ───────────────────────────────────────────────────────────────────────────

/** The verdict the confidence-gate returns. Immutable, posture-only. */
export interface CalibratedConfidence {
  /** The confidence the MD should actually SPEAK (≤ claimed). */
  readonly adjustedConfidence: number;
  /** True when the gate pulled the number down from what was claimed. */
  readonly downShifted: boolean;
  /** A short humility line to prepend, or null when the topic is well-calibrated. */
  readonly humilityPrefix: string | null;
  /** The historical land-rate of the claimed band for this topic (0..1), or null. */
  readonly observedLandRate: number | null;
}

/**
 * The minimum number of reconciled samples in a band before its land-rate is
 * trusted enough to down-shift. Below it the curve is too thin — speak the
 * claimed confidence (no spurious humility on one unlucky row).
 */
const MIN_BAND_SAMPLES = 4;

/** Pick the curve band that CONTAINS the claimed confidence. */
function bandContaining(
  curve: readonly CalibrationCurvePoint[],
  claimedConfidence: number,
): CalibrationCurvePoint | null {
  const c = Math.max(0, Math.min(1, claimedConfidence));
  for (const point of curve) {
    // Upper-inclusive on the top band so claimed=1.0 lands somewhere.
    const top = point.confidenceUpper >= 1 ? point.confidenceUpper + 1e-9 : point.confidenceUpper;
    if (c >= point.confidenceLower && c < top) return point;
  }
  return null;
}

/**
 * The confidence-gate. Given the per-domain calibration curve and the confidence
 * the MD is ABOUT to claim, return the confidence it should actually speak + an
 * optional humility prefix. Pure + total. When the claimed band has historically
 * only matched `landRate` of the time, the spoken confidence is pulled toward the
 * MEASURED land-rate (never above the claim) and a one-line hedge is prepended.
 *
 * `topicLabel` is a human label for the domain (e.g. "cost", "compliance
 * timing") used only in the prefix copy — never the raw action-kind slug.
 */
export function applyCalibratedHumility(
  curve: readonly CalibrationCurvePoint[],
  claimedConfidence: number,
  topicLabel: string,
): CalibratedConfidence {
  const claimed = Math.max(0, Math.min(1, claimedConfidence));
  const band = bandContaining(curve, claimed);
  if (!band || band.count < MIN_BAND_SAMPLES) {
    return Object.freeze({
      adjustedConfidence: claimed,
      downShifted: false,
      humilityPrefix: null,
      observedLandRate: band ? band.matchedFraction : null,
    });
  }

  const landRate = band.matchedFraction;
  // Well-calibrated (or better than claimed) → speak the claim, no hedge.
  if (landRate >= claimed - 0.05) {
    return Object.freeze({
      adjustedConfidence: claimed,
      downShifted: false,
      humilityPrefix: null,
      observedLandRate: landRate,
    });
  }

  // Over-confident on this topic. Pull the spoken confidence toward the measured
  // land-rate (blend, weighted to reality), and prepend a posture-only hedge.
  const adjusted = Number((claimed * 0.35 + landRate * 0.65).toFixed(2));
  const prefix =
    landRate <= 0.5
      ? `I'd hedge on ${topicLabel} — my recent calls there have been shaky.`
      : `Slightly less sure on ${topicLabel} than usual — recent calls have run a bit off.`;
  return Object.freeze({
    adjustedConfidence: Math.min(claimed, adjusted),
    downShifted: true,
    humilityPrefix: prefix,
    observedLandRate: landRate,
  });
}

/**
 * Map a `CalibrationDriftEvent` (the previously-unconsumed alerter output) to an
 * `EstateProposal` so a sustained dip surfaces through the gated proactive sink.
 * Pure. driveId is `royalty-currency` (a standing financial-discipline concern);
 * the breachSeverity scales with how far accuracy fell below the floor so the
 * homeostatic controller grades the surface. Evidence-required rail satisfied by
 * the predictionCount as a soft evidence count (no entity ids — this is a
 * meta-signal about the MD itself).
 */
export function calibrationDriftToProposal(
  event: CalibrationDriftEvent,
  nowMs: number = Date.now(),
): EstateProposal {
  // accuracy in [0,1]; the further below the 0.6 floor, the higher the severity.
  const breachSeverity = Math.max(0, Math.min(1, (0.6 - event.accuracy) / 0.6));
  return Object.freeze({
    tenantId: event.tenantId,
    id: `calibration-drift:${event.tenantId}`,
    driveId: 'royalty-currency' as EstateProposal['driveId'],
    title: 'My recent predictions have drifted — recalibrating',
    rationale: `Across ${event.verdictCount} recent reconciled calls my accuracy fell to ${(
      event.accuracy * 100
    ).toFixed(0)}% (mean drift ${event.meanDrift.toFixed(2)}). I'm hedging affected topics until the calls land again.`,
    urgency: breachSeverity >= 0.6 ? 'critical' : 'high',
    breachSeverity,
    evidenceEntityIds: [],
    proposedAtMs: nowMs,
  });
}

/**
 * Bind the unconsumed `CalibrationDriftSink` to the estate-mind proposal sink.
 * Returns a sink the composition root passes to `createCalibrationAlerter` so a
 * crossed-floor drift event becomes a gated proactive proposal. Fail-soft: a
 * sink fault is swallowed (a meta-signal must never break the alerter); the
 * optional logger records it. PROPOSE-ONLY — never actuates.
 */
export function bindCalibrationDriftToProposalSink(
  proposalSink: ProposalSink,
  logger?: ConformalLoopLogger,
  now: () => number = () => Date.now(),
): (event: CalibrationDriftEvent) => void {
  return (event: CalibrationDriftEvent): void => {
    // The alerter's sink is sync; surface the proposal on a detached promise so a
    // slow/failing sink never blocks the alerter's inspect() call.
    void Promise.resolve()
      .then(() => proposalSink.propose(calibrationDriftToProposal(event, now())))
      .catch((err) => {
        logger?.warn(
          {
            feed: 'calibration-drift-proposal',
            tenantId: event.tenantId,
            error: err instanceof Error ? err.message : String(err),
          },
          'calibration-drift: proposal surface failed (swallowed)',
        );
      });
  };
}
