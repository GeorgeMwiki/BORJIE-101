/**
 * Turn-thumbs → conformal coverage feed.
 *
 * The REAL outcome side of the online-ACI loop for the CHAT-TURN prediction type
 * (`chat_turn_confidence`). The chat path READS this tenant's calibrated alpha at
 * emit time (`applyChatConformalConfidence` → `getCalibratedAlpha`) to shift the
 * confidence tiers it ships on the `message_chunk`. Until this feed existed
 * NOTHING fed that alpha's OUTCOME, so the chat-turn alpha never left its
 * cold-start default — this module closes that gap to zero.
 *
 * THE SIGNAL (already exists): a Jarvis 👍 / 👎 click on a specific assistant
 * turn arrives at `routes/feedback.ts` as `{ turnId, signal }`. Semantics:
 *   - UP   → the answer was ACCEPTED → its emitted confidence was justified →
 *            the prediction interval was COVERED  (covered = true).
 *   - DOWN → the answer was DISPUTED → its confidence was NOT justified →
 *            the interval was NOT covered          (covered = false).
 * That is a legitimate coverage observation for online ACI: folding the bit
 * through the state machine MOVES the calibrated alpha toward target coverage, so
 * the alpha is learned from REAL user signal, never a fabricated constant.
 *
 * WHY ENROLL-AND-OBSERVE AT FEEDBACK TIME (not emit time):
 *   The orchestrator's `message_chunk` SSE frame carries no turn id (verified:
 *   it emits text + evidence_ids + confidence only), so there is no stable id
 *   round-tripping from emit to the client's `body.turnId`. Linking an
 *   emit-time prediction row to a feedback-time outcome would therefore need an
 *   unproven id contract. Instead we enroll the prediction AND record its
 *   outcome together at feedback time, keyed on the client's `turnId` — exactly
 *   the shape `reconciliation-conformal-feed.ts` uses for its real signal. The
 *   ACI math only consumes the `covered` bit (see `aci.ts updateConformal`), and
 *   `conformal_observations` has NO FK to `conformal_predictions` (migration
 *   0299: "the (tenant_id, prediction_id) pair is the logical join"), so the
 *   enrolled prediction is purely an audit-trail row — the loop advances on the
 *   coverage bit regardless.
 *
 * TENANT SCOPE (CLAUDE.md RLS hard rule): the feedback route's `db` handle is the
 * unpinned base client (no tenant-pinning middleware on `/feedback`), so this
 * feed MUST bind the `app.current_tenant_id` GUC itself. It opens a SHORT
 * `withTenantContext` transaction so RLS FORCE sees the tenant on every
 * conformal_* statement — mirroring `chat-conformal-confidence.ts`.
 *
 * FAIL-SOFT (CLAUDE.md): a calibration write must NEVER break the thumbs
 * feedback write it follows. Every failure (no db, no usable signal, store
 * error) is swallowed behind the optional Pino warn sink and returns `null`. No
 * `console.log`.
 */

import { withTenantContext } from '@borjie/database';
import { createDrizzleConformalStore } from './drizzle-conformal-store.js';
import {
  createConformalCalibrationLoop,
  type ConformalLoopLogger,
} from './conformal-calibration-loop.js';
import { CHAT_CONFIDENCE_PREDICTION_TYPE } from './chat-conformal-confidence.js';

/** Normalised thumbs direction (the feedback route collapses the verbose forms). */
export type TurnThumbsSignal = 'up' | 'down';

export interface TurnThumbsConformalInput {
  readonly tenantId: string;
  /** The client-supplied stable id of the assistant turn (1:1 with this outcome). */
  readonly turnId: string;
  /** Normalised thumbs direction — UP ⇒ covered, DOWN ⇒ not covered. */
  readonly signal: TurnThumbsSignal;
  /** Thread the turn belonged to (audit trail only). */
  readonly threadId?: string | null;
  /** Actor who clicked (audit trail only). */
  readonly userId?: string | null;
}

/** UP ⇒ the answer was accepted ⇒ the interval was covered. */
export function thumbsToCovered(signal: TurnThumbsSignal): boolean {
  return signal === 'up';
}

/**
 * Fold a turn-thumbs click into the online-ACI loop for the chat-turn prediction
 * type. `db` is the request-scoped (UNPINNED) Drizzle handle from the feedback
 * route — this function binds the tenant GUC itself via `withTenantContext` so
 * RLS fires on the conformal_* writes.
 *
 * Returns the new alpha when the loop advanced, or `null` when the feed was a
 * no-op (missing db / empty tenant or turn id) or the write failed. NEVER throws
 * past this boundary.
 */
export async function feedTurnThumbsToConformal(
  db: unknown,
  input: TurnThumbsConformalInput,
  logger?: ConformalLoopLogger,
): Promise<{ alpha: number } | null> {
  // Honest no-ops: nothing observable to learn from.
  if (!db) return null;
  if (!input.tenantId || !input.turnId) return null;

  const covered = thumbsToCovered(input.signal);
  const observedAtIso = new Date().toISOString();
  const metadata = {
    source: 'turn-thumbs',
    signal: input.signal,
    ...(input.threadId ? { threadId: input.threadId } : {}),
  } as const;

  try {
    return await withTenantContext(
      db as Parameters<typeof withTenantContext>[0],
      input.tenantId,
      async (tx) => {
        const loop = createConformalCalibrationLoop({
          store: createDrizzleConformalStore(tx),
          ...(logger ? { logger } : {}),
        });

        // 1. Enroll (or idempotently refresh) the chat-turn prediction keyed on
        //    the client's turnId so the audit table has a row alongside the
        //    observation. No interval is recorded — a chat-turn's coverage bit
        //    comes from the user's accept/dispute signal, not a numeric band.
        await loop.recordPrediction({
          tenantId: input.tenantId,
          predictionId: input.turnId,
          predictionType: CHAT_CONFIDENCE_PREDICTION_TYPE,
          metadata,
          ...(input.userId ? { createdBy: input.userId } : {}),
        });

        // 2. Record the coverage outcome — THIS advances the calibrated alpha
        //    the chat path reads on subsequent turns.
        return await loop.recordOutcome({
          tenantId: input.tenantId,
          predictionId: input.turnId,
          predictionType: CHAT_CONFIDENCE_PREDICTION_TYPE,
          covered,
          observedAtIso,
          metadata,
          ...(input.userId ? { createdBy: input.userId } : {}),
        });
      },
    );
  } catch (err) {
    logger?.warn(
      {
        feed: 'feedback-conformal',
        predictionType: CHAT_CONFIDENCE_PREDICTION_TYPE,
        error: err instanceof Error ? err.message : String(err),
      },
      'feedback-conformal: feed failed; chat-turn alpha not advanced',
    );
    return null;
  }
}
