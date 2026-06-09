/**
 * The RECONCILE engine — the never-drop-a-thread sweep that implements the
 * kernel's `ReconciliationPort` over the durable `md_commitments` store.
 *
 * Hosted inside `EstateMind.tick()` (between ORIENT and PROPOSE). On each tick,
 * for one tenant, it:
 *
 *   1. RE-READS all live commitments (the whole backlog — nothing closes by
 *      forgetting).
 *   2. WAIT-FOR eval — recompute due/overdue/blocked:
 *        time      → trigger_due_at <= now
 *        event     → handled out-of-band by the event subscriber (flips to due);
 *                    here we honour the resulting status + the deadline fallback
 *        condition → predicate evaluated each tick (+ deadline fallback so
 *                    silence still surfaces)
 *   3. RESURFACE due/overdue through the EXISTING gated proposal sink
 *      (proactive_nudge + the dual OrchestratorRequest spine emission).
 *   4. ADVANCE the reminder ladder one rung (gated on ack); for an overdue
 *      SOVEREIGN obligation the top rung is the HITL SAFE-HALT — it NEVER
 *      auto-actuates.
 *   5. CLOSE-THE-LOOP: a commitment closes ONLY on positive proof; an
 *      acknowledged-but-unconfirmed sovereign item past its confirmation
 *      deadline is RE-OPENED (never silently closed).
 *
 * FAIL-SAFE: `reconcile` never throws — a store/sink/ladder fault degrades the
 * sweep (recorded in `degradedReason`) and never breaks the EstateMind tick.
 * BUDGET-BOUNDED: the sweep processes at most `maxPerTick` commitments; the
 * rest are picked up next tick (the loop slows, it never stops tracking).
 *
 * GOVERNANCE: money/licence/deletion stay HITL. The sweep only ever moves a
 * commitment's status, advances its ladder, or surfaces a proposal — it has no
 * executor handle. Honest status throughout. No `console.*` (Pino shim only).
 */

import type {
  MdCommitment,
  MdCommitmentRepository,
} from '@borjie/database/repositories';
import type { estateMind as estateMindKernel } from '@borjie/central-intelligence';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';

import { runLadder, type LadderDispatchers, type LadderPrefs } from './ladder-engine.js';
import {
  evaluateConditionPredicate,
  type ConditionEvaluator,
} from './wait-for.js';

type ReconciliationPort = estateMindKernel.ReconciliationPort;
type ReconcileResult = estateMindKernel.ReconcileResult;
type EstateProposal = estateMindKernel.EstateProposal;
type ProposalSink = estateMindKernel.ProposalSink;

/** A confirmation-proof checker — does a positive proof exist for this commitment? */
export interface ConfirmationProbe {
  /**
   * Return the proof kind (e.g. 'ledger_entry' | 'regulator_ack' |
   * 'owner_approved') when the commitment's completion is positively confirmed,
   * else null. Closure is honest — the engine only marks `done` when this
   * returns a proof.
   */
  proofFor(c: MdCommitment): Promise<string | null>;
}

/** Append a hash-chained closure / transition row. Best-effort, never throws. */
export interface CommitmentAuditSink {
  append(entry: {
    readonly tenantId: string;
    readonly commitmentId: string;
    readonly transition: string;
    readonly sovereign: boolean;
    readonly occurredAtMs: number;
  }): Promise<string | null>;
}

export interface ReconcileEngineDeps {
  readonly repo: MdCommitmentRepository;
  /** The SAME gated proposal sink EstateMind already surfaces goals through. */
  readonly proposalSink: ProposalSink;
  readonly ladderDispatchers: LadderDispatchers;
  readonly ladderPrefs?: LadderPrefs;
  /** Evaluates a `condition` trigger predicate against estate state. */
  readonly conditionEvaluator?: ConditionEvaluator | null;
  /** Positive-proof probe for close-the-loop. When omitted, nothing auto-closes. */
  readonly confirmationProbe?: ConfirmationProbe | null;
  readonly auditSink?: CommitmentAuditSink | null;
  readonly logger: PinoLikeLogger;
  /** Budget bound: max commitments processed per tick (default 100). */
  readonly maxPerTick?: number;
  /**
   * Confirmation deadline (ms) after a sovereign item is acknowledged: if no
   * positive proof lands within this window the item RE-OPENS. Default 7 days.
   */
  readonly confirmationDeadlineMs?: number;
}

const DEFAULT_MAX_PER_TICK = 100;
const DEFAULT_CONFIRMATION_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Build the `ReconciliationPort` the composition root injects into EstateMind.
 */
export function createReconcileEngine(
  deps: ReconcileEngineDeps,
): ReconciliationPort {
  const maxPerTick = deps.maxPerTick ?? DEFAULT_MAX_PER_TICK;
  const confirmationDeadlineMs =
    deps.confirmationDeadlineMs ?? DEFAULT_CONFIRMATION_DEADLINE_MS;
  const ladderPrefs: LadderPrefs = deps.ladderPrefs ?? {};

  return {
    async reconcile({ tenantId, nowMs }): Promise<ReconcileResult> {
      let reviewed = 0;
      let surfaced = 0;
      let escalated = 0;
      let confirmed = 0;
      let reopened = 0;
      let degradedReason: string | null = null;

      let live: ReadonlyArray<MdCommitment>;
      try {
        live = await deps.repo.listLive(tenantId);
      } catch (err) {
        // A store fault never breaks the tick — degrade and bail.
        deps.logger.warn(
          { tenantId, err: errMsg(err) },
          'md-commitments: reconcile listLive failed — sweep degraded',
        );
        return Object.freeze({
          reviewed: 0,
          surfaced: 0,
          escalated: 0,
          confirmed: 0,
          reopened: 0,
          degradedReason: 'listLive-failed',
        });
      }

      const batch = live.slice(0, maxPerTick);
      for (const c of batch) {
        reviewed += 1;
        try {
          const outcome = await reconcileOne(c, {
            tenantId,
            nowMs,
            repo: deps.repo,
            proposalSink: deps.proposalSink,
            ladderDispatchers: deps.ladderDispatchers,
            ladderPrefs,
            conditionEvaluator: deps.conditionEvaluator ?? null,
            confirmationProbe: deps.confirmationProbe ?? null,
            auditSink: deps.auditSink ?? null,
            confirmationDeadlineMs,
            logger: deps.logger,
          });
          surfaced += outcome.surfaced ? 1 : 0;
          escalated += outcome.escalated ? 1 : 0;
          confirmed += outcome.confirmed ? 1 : 0;
          reopened += outcome.reopened ? 1 : 0;
        } catch (err) {
          // One pathological commitment never aborts the whole sweep.
          degradedReason = degradedReason ?? 'commitment-failed';
          deps.logger.warn(
            { tenantId, commitmentId: c.id, err: errMsg(err) },
            'md-commitments: reconcile of one commitment failed (isolated)',
          );
        }
      }

      if (live.length > batch.length) {
        // Budget bound hit — the rest surface next tick (slow, never drop).
        degradedReason = degradedReason ?? 'budget-bounded';
      }

      return Object.freeze({
        reviewed,
        surfaced,
        escalated,
        confirmed,
        reopened,
        degradedReason,
      });
    },
  };
}

interface OneOutcome {
  readonly surfaced: boolean;
  readonly escalated: boolean;
  readonly confirmed: boolean;
  readonly reopened: boolean;
}

interface OneDeps {
  readonly tenantId: string;
  readonly nowMs: number;
  readonly repo: MdCommitmentRepository;
  readonly proposalSink: ProposalSink;
  readonly ladderDispatchers: LadderDispatchers;
  readonly ladderPrefs: LadderPrefs;
  readonly conditionEvaluator: ConditionEvaluator | null;
  readonly confirmationProbe: ConfirmationProbe | null;
  readonly auditSink: CommitmentAuditSink | null;
  readonly confirmationDeadlineMs: number;
  readonly logger: PinoLikeLogger;
}

/**
 * Reconcile ONE commitment: WAIT-FOR eval → resurface → ladder → close/re-open.
 * Returns what changed for the sweep counters.
 */
async function reconcileOne(
  c: MdCommitment,
  deps: OneDeps,
): Promise<OneOutcome> {
  // ── CLOSE-THE-LOOP first: a confirmed-pending item may now have proof. ────
  // A commitment that was acked is awaiting a positive completion proof.
  if (c.ackedAtMs !== null && deps.confirmationProbe) {
    const proof = await deps.confirmationProbe.proofFor(c);
    if (proof) {
      const hash = await safeAudit(deps.auditSink, {
        tenantId: deps.tenantId,
        commitmentId: c.id,
        transition: `confirmed:${proof}`,
        sovereign: c.sovereign,
        occurredAtMs: deps.nowMs,
      });
      await deps.repo.markDone(deps.tenantId, c.id, {
        confirmationKind: proof,
        auditChainHash: hash,
      });
      return { surfaced: false, escalated: false, confirmed: true, reopened: false };
    }
    // Acked but still no proof past the confirmation deadline → RE-OPEN.
    const deadlinePassed =
      deps.nowMs - c.ackedAtMs >= deps.confirmationDeadlineMs;
    if (deadlinePassed) {
      const hash = await safeAudit(deps.auditSink, {
        tenantId: deps.tenantId,
        commitmentId: c.id,
        transition: 'reopened:confirmation-deadline',
        sovereign: c.sovereign,
        occurredAtMs: deps.nowMs,
      });
      await deps.repo.reopen(deps.tenantId, c.id, hash);
      return { surfaced: false, escalated: false, confirmed: false, reopened: true };
    }
    // Acked, within the confirmation window → hold, nothing to do this tick.
    return { surfaced: false, escalated: false, confirmed: false, reopened: false };
  }

  // ── WAIT-FOR eval — is this commitment due/overdue now? ───────────────────
  const due = isDue(c, deps.nowMs, deps.conditionEvaluator);
  if (!due) {
    return { surfaced: false, escalated: false, confirmed: false, reopened: false };
  }

  // someday class is reviewed, never auto-fired up the intrusive ladder.
  // It surfaces a review-only proposal and stays at rung 0.
  const reviewOnly = c.class === 'someday';

  // ── RESURFACE through the existing gated proposal sink. ───────────────────
  let surfaced = false;
  try {
    const accepted = await deps.proposalSink.propose(toProposal(c, deps.nowMs));
    surfaced = accepted;
  } catch (err) {
    deps.logger.warn(
      { tenantId: deps.tenantId, commitmentId: c.id, err: errMsg(err) },
      'md-commitments: resurface propose failed (swallowed)',
    );
  }

  if (reviewOnly) {
    // Mark overdue→scheduled-review without climbing the ladder.
    await deps.repo.transition(deps.tenantId, c.id, {
      status: 'scheduled',
      lastNudgedAt: new Date(deps.nowMs),
    });
    return { surfaced, escalated: false, confirmed: false, reopened: false };
  }

  // ── LADDER — advance one rung (gated on ack); sovereign top rung = safe-halt.
  const decision = await runLadder(
    c,
    deps.ladderDispatchers,
    deps.ladderPrefs,
    deps.nowMs,
    deps.logger,
  );

  const escalated = decision.rung >= 4 || decision.safeHalt;

  if (decision.dispatched) {
    const hash = await safeAudit(deps.auditSink, {
      tenantId: deps.tenantId,
      commitmentId: c.id,
      transition: decision.safeHalt
        ? 'safe_halt:surfaced'
        : `ladder:rung-${decision.rung}`,
      sovereign: c.sovereign,
      occurredAtMs: deps.nowMs,
    });
    // overdue is the honest status for a fired-but-unacked obligation past due.
    await deps.repo.transition(deps.tenantId, c.id, {
      status: 'overdue',
      rungLevel: decision.rung,
      attemptCount: c.attemptCount + 1,
      lastNudgedAt: new Date(deps.nowMs),
      auditChainHash: hash,
    });
  }

  return { surfaced, escalated, confirmed: false, reopened: false };
}

/**
 * WAIT-FOR — is the commitment due to fire NOW?
 *   time      → trigger_due_at <= now
 *   event     → the event subscriber already flipped status to overdue when the
 *               eventKey fired; here the deadline fallback also surfaces it
 *   condition → predicate true, OR the deadline fallback passed (silence still
 *               surfaces — never a dropped thread)
 */
function isDue(
  c: MdCommitment,
  nowMs: number,
  conditionEvaluator: ConditionEvaluator | null,
): boolean {
  // An already-overdue/reopened item is due by definition (keep climbing).
  if (c.status === 'overdue' || c.status === 'reopened') return true;

  const deadlinePassed =
    c.triggerDueAtMs !== null && c.triggerDueAtMs <= nowMs;

  switch (c.triggerKind) {
    case 'time':
      return deadlinePassed;
    case 'event':
      // The subscriber flips status when the event fires; the deadline is the
      // always-on fallback so silence still surfaces.
      return deadlinePassed;
    case 'condition': {
      const predicateHolds = evaluateConditionPredicate(
        c.triggerSpec.predicate,
        conditionEvaluator,
      );
      return predicateHolds || deadlinePassed;
    }
    default:
      return false;
  }
}

function toProposal(c: MdCommitment, nowMs: number): EstateProposal {
  const urgency: EstateProposal['urgency'] = c.sovereign ? 'critical' : 'high';
  return Object.freeze({
    tenantId: c.tenantId,
    // Stable dedupe id — the same commitment coalesces across ticks.
    id: `commitment:${c.id}`,
    driveId: 'royalty-currency',
    title: c.title,
    rationale: c.rationale,
    urgency,
    breachSeverity: c.sovereign ? 1 : 0.6,
    evidenceEntityIds: c.evidenceIds,
    proposedAtMs: nowMs,
  });
}

async function safeAudit(
  sink: CommitmentAuditSink | null,
  entry: {
    readonly tenantId: string;
    readonly commitmentId: string;
    readonly transition: string;
    readonly sovereign: boolean;
    readonly occurredAtMs: number;
  },
): Promise<string | null> {
  if (!sink) return null;
  try {
    return await sink.append(entry);
  } catch {
    // Audit is best-effort here — the transition still records on the row.
    return null;
  }
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
