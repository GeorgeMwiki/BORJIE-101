/**
 * WAIT-FOR — the trigger primitive for the MD DEFERRAL organ (time | event |
 * condition), the event-source seam, and the condition predicate evaluator.
 *
 * Three trigger classes, all replay-safe:
 *   - time      — handled by the durable poll (the reminders-dispatch claim
 *                 pattern re-aimed at md_commitments WHERE trigger_kind='time'
 *                 AND trigger_due_at<=now). See repo.listDueByTime().
 *   - event     — `subscribeWaitForEvents` maps an EXISTING event onto a
 *                 commitment: on a `LedgerService.post()` credit, an offtake
 *                 settlement, or a blackboard SLOT_DELTA stale-decay, it flips
 *                 the matching waiting commitments → due (idempotent — webhooks
 *                 + ledger posts are at-least-once).
 *   - condition — `evaluateConditionPredicate` evaluates a serialised predicate
 *                 against estate state each reconcile tick; the trigger_deadline
 *                 fallback (in reconcile-engine) surfaces it even if the
 *                 predicate never holds, so silence is never a dropped thread.
 *
 * GOVERNANCE: an event flip only moves a commitment to `due` (it makes the
 * brain CONSIDER acting). It NEVER auto-actuates a sovereign action — that
 * still routes through the ladder + safe-halt. No `console.*` (Pino shim only).
 */

import type { MdCommitmentRepository } from '@borjie/database/repositories';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';

// ---------------------------------------------------------------------------
// Condition predicate evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluates a `condition` trigger predicate against current estate state. The
 * composition root binds a real evaluator (reads the situational model / mining
 * graph); tests inject a stub. Returning `undefined` means "unknown" → the
 * deadline fallback decides.
 */
export interface ConditionEvaluator {
  evaluate(predicate: Record<string, unknown>): boolean | undefined;
}

/**
 * Pure helper used by the reconcile sweep. Returns true ONLY when the evaluator
 * affirmatively reports the predicate holds. An absent predicate or an absent /
 * unknown evaluator result is false here — the deadline fallback (in the
 * reconcile engine) is the safety net that still surfaces the commitment.
 */
export function evaluateConditionPredicate(
  predicate: Record<string, unknown> | undefined,
  evaluator: ConditionEvaluator | null,
): boolean {
  if (!predicate || !evaluator) return false;
  try {
    return evaluator.evaluate(predicate) === true;
  } catch {
    // A faulty evaluator never forces a fire — the deadline fallback covers it.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Event subscriber — flips waiting event commitments → due on a fired eventKey
// ---------------------------------------------------------------------------

/**
 * The seam an existing event source calls when its signal fires. The
 * composition root subscribes this to:
 *   - `LedgerService.post()` post-commit CREDIT hook  → eventKey 'ledger.credit'
 *   - the settlement webhook handler                  → eventKey 'offtake.settled'
 *   - the blackboard SLOT_DELTA stale-decay broadcaster → eventKey 'slot.stale'
 *
 * Flips every waiting commitment whose trigger_event matches → overdue (the
 * honest "now actionable" status). Idempotent: a re-delivered event re-flips an
 * already-overdue row to overdue (a no-op), so at-least-once delivery is safe.
 *
 * NEVER actuates — it only moves status. A flipped sovereign commitment still
 * climbs the ladder to the HITL safe-halt; it is never auto-filed.
 */
export interface WaitForEventSubscriber {
  /** Fire all waiting commitments for (tenant, eventKey). Returns the count flipped. */
  onEvent(input: {
    readonly tenantId: string;
    readonly eventKey: string;
    readonly nowMs?: number;
  }): Promise<number>;
}

export function createWaitForEventSubscriber(deps: {
  readonly repo: MdCommitmentRepository;
  readonly logger: PinoLikeLogger;
}): WaitForEventSubscriber {
  return {
    async onEvent({ tenantId, eventKey, nowMs }) {
      const now = nowMs ?? Date.now();
      try {
        const waiting = await deps.repo.listWaitingForEvent(tenantId, eventKey);
        let flipped = 0;
        for (const c of waiting) {
          // Flip to overdue (actionable now). The reconcile sweep picks it up
          // on the next tick to resurface + climb the ladder.
          await deps.repo.transition(tenantId, c.id, {
            status: 'overdue',
            lastNudgedAt: c.lastNudgedAtMs ? new Date(c.lastNudgedAtMs) : null,
          });
          flipped += 1;
        }
        if (flipped > 0) {
          deps.logger.info(
            { tenantId, eventKey, flipped, ts: now },
            'md-commitments: wait-for event flipped commitments → due',
          );
        }
        return flipped;
      } catch (err) {
        // A fault here never breaks the event source (ledger post / webhook).
        deps.logger.warn(
          {
            tenantId,
            eventKey,
            err: err instanceof Error ? err.message : String(err),
          },
          'md-commitments: wait-for event subscriber failed (swallowed)',
        );
        return 0;
      }
    },
  };
}
