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

// ───────────────────────────────────────────────────────────────────────────
// WIN-3 — Graded homeostatic controller (nudge → draft → delegate).
//
// Today the proposal that resurfaces a commitment FABRICATES its drive identity
// + breachSeverity (`driveId: 'royalty-currency'`, `breachSeverity: c.sovereign
// ? 1 : 0.6`) because the real standing-drive severity never reached this engine.
// The CorrectiveLadderPolicy + drive→drafter registry are the ROUTING LAYER that
// thread the TRUE severity through and bind each drive to its matching drafter as
// the mid-rung corrective. The drives and the drafters already exist and emit;
// this is the wire between them. Every rung respects the inhibition membrane: a
// drafter writes a DRAFT proposal row (HITL), it NEVER auto-executes, and the
// ≥0.6 rung is the owner-direct safe-halt that parks for human confirmation.
// ───────────────────────────────────────────────────────────────────────────

/** The graded corrective rungs, ordered by escalating help (not loudness). */
export type CorrectiveRung = 'nudge' | 'draft' | 'delegate';

/**
 * The standing-drive context for a commitment — the REAL drive identity +
 * breachSeverity, resolved from the live drive set. Returning `null` means the
 * commitment isn't bound to a standing drive; the engine then honest-degrades to
 * its prior fabricated-severity behaviour (no regression for unbound items).
 */
export interface DriveContext {
  /** The standing drive this commitment serves (a `DriveId` slug). */
  readonly driveId: string;
  /** REAL breach severity in [0,1] from the drive evaluator (NOT fabricated). */
  readonly breachSeverity: number;
}

/**
 * Resolve a commitment's standing-drive context. The composition root binds this
 * from the live drive snapshot; when omitted the engine keeps its prior
 * behaviour. Pure read — never mutates the commitment. Best-effort: a thrown
 * resolver degrades to `null` (handled by the caller).
 */
export interface DriveContextResolver {
  resolve(c: MdCommitment): Promise<DriveContext | null>;
}

/**
 * A drive's bound DRAFTER — builds a real corrective artifact (a DRAFT proposal
 * row into `mwikila_actions_inbox`: a pre-filled royalty filing / licence
 * renewal packet / payroll run) and returns whether a draft was written. It is
 * PROPOSE-ONLY: the row lands `proposed` for HITL review, never executed. A
 * thrown drafter is swallowed by the engine (a drafter outage never breaks the
 * sweep). Keyed by `driveId` in the registry below.
 */
export type DrafterFn = (
  c: MdCommitment,
  ctx: { readonly tenantId: string; readonly nowMs: number; readonly breachSeverity: number },
) => Promise<{ readonly drafted: boolean; readonly draftRef?: string }>;

/** driveId → its bound drafter. A small typed map; the routing layer's table. */
export type DrafterRegistry = ReadonlyMap<string, DrafterFn>;

/**
 * The autonomy cap — the engine NEVER drafts/delegates above the tenant's
 * delegation ceiling. `draft` requires `>= 'draft'`; `delegate` requires
 * `>= 'delegate'`. Below the cap the corrective falls back to the next-lower
 * rung (delegate→draft→nudge) so help is offered without breaching governance.
 */
export type AutonomyCap = 'nudge' | 'draft' | 'delegate';

/**
 * Map (breachSeverity) → the corrective rung, then clamp to the autonomy cap.
 * The bands mirror the win spec:
 *   severity < 0.25      → nudge   (just surface it)
 *   0.25 ≤ severity < 0.6 → draft   (invoke the drive's drafter; review-and-file)
 *   severity ≥ 0.6        → delegate (owner-direct safe-halt with the draft attached)
 * Pure + total. The drive's own urgency band already coarse-grains the same
 * severity; this turns it into the graded ACTION the controller takes.
 */
export function correctiveRungFor(
  breachSeverity: number,
  cap: AutonomyCap = 'delegate',
): CorrectiveRung {
  const s = clamp01(breachSeverity);
  const desired: CorrectiveRung = s >= 0.6 ? 'delegate' : s >= 0.25 ? 'draft' : 'nudge';
  return clampToCap(desired, cap);
}

const RUNG_ORDER: ReadonlyArray<CorrectiveRung> = ['nudge', 'draft', 'delegate'];

function clampToCap(rung: CorrectiveRung, cap: AutonomyCap): CorrectiveRung {
  const want = RUNG_ORDER.indexOf(rung);
  const ceil = RUNG_ORDER.indexOf(cap);
  return RUNG_ORDER[Math.min(want, ceil)] ?? 'nudge';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// ───────────────────────────────────────────────────────────────────────────
// WIN-4 — Closed-loop set-point regulation (perceive → act → re-observe → did
// it recover?). The confirmation-probe answers "did the COMMITMENT get done?"
// but never "did the SET-POINT recover?". The delta-evaluator below compares
// last tick's breachSeverity to this tick's and decides continuity-of-care:
//   (a) breach cleared      → 'recovered'  (close the open corrective)
//   (b) improving, breached → 'improving'  (SUPPRESS a fresh nudge — it's working)
//   (c) worsening N ticks    → 'worsening'  (AUTO-PROMOTE the corrective one rung)
// The per-(tenant,driveId) prior state round-trips through the existing
// situational-entity `attributes` jsonb via the SetPointStateStore port.
// ───────────────────────────────────────────────────────────────────────────

/** The per-(tenant,driveId) regulation memory, persisted across ticks. */
export interface SetPointState {
  readonly priorBreachSeverity: number;
  readonly consecutiveWorseningTicks: number;
}

/**
 * Round-trips the set-point regulation memory through durable storage (the
 * existing `situational_model_entities.attributes` jsonb). Returning `null` from
 * `read` means "no prior tick" (first observation). Best-effort: a store fault
 * degrades the set-point arc to a no-op (the controller still nudges), never a
 * throw on the hot path.
 */
export interface SetPointStateStore {
  read(tenantId: string, driveId: string): Promise<SetPointState | null>;
  write(tenantId: string, driveId: string, next: SetPointState): Promise<void>;
}

/** The continuity-of-care verdict the delta-evaluator emits each tick. */
export interface SetPointDelta {
  readonly disposition: 'recovered' | 'improving' | 'worsening' | 'first-observation';
  /** current − prior (negative = improving, positive = worsening). */
  readonly deltaSeverity: number;
  /** Worsening-streak length AFTER this tick (drives the auto-promote). */
  readonly consecutiveWorseningTicks: number;
  /** True when (c) fired: worsening past the streak floor despite an open corrective. */
  readonly autoPromote: boolean;
  /** True when (b) fired: improving-but-breached → suppress a fresh nudge. */
  readonly suppressNudge: boolean;
  /** The state to persist for the NEXT tick (immutable; never mutate the prior). */
  readonly nextState: SetPointState;
}

/** Default: auto-promote after this many consecutive worsening ticks. */
const DEFAULT_WORSENING_TICKS_FLOOR = 3;
/** A breach is "cleared" when current severity drops to/below this. */
const BREACH_CLEARED_AT = 0.05;
/** Hysteresis: only count a change as real movement past this magnitude. */
const SETPOINT_NOISE_FLOOR = 0.02;

/**
 * Pure set-point delta-evaluator. Compares the prior breachSeverity (from the
 * store) to the current one and returns the continuity-of-care verdict + the
 * next state to persist. Total + immutable; no I/O.
 */
export function evaluateSetPointDelta(
  prior: SetPointState | null,
  currentBreachSeverity: number,
  options?: { readonly worseningTicksFloor?: number; readonly hasOpenCorrective?: boolean },
): SetPointDelta {
  const current = clamp01(currentBreachSeverity);
  const floor = options?.worseningTicksFloor ?? DEFAULT_WORSENING_TICKS_FLOOR;
  const hasOpenCorrective = options?.hasOpenCorrective ?? true;

  if (prior === null) {
    return Object.freeze({
      disposition: 'first-observation',
      deltaSeverity: 0,
      consecutiveWorseningTicks: 0,
      autoPromote: false,
      suppressNudge: false,
      nextState: Object.freeze({ priorBreachSeverity: current, consecutiveWorseningTicks: 0 }),
    });
  }

  const deltaSeverity = current - prior.priorBreachSeverity;

  // (a) breach cleared — the corrective worked; close the loop.
  if (current <= BREACH_CLEARED_AT) {
    return Object.freeze({
      disposition: 'recovered',
      deltaSeverity,
      consecutiveWorseningTicks: 0,
      autoPromote: false,
      suppressNudge: false,
      nextState: Object.freeze({ priorBreachSeverity: current, consecutiveWorseningTicks: 0 }),
    });
  }

  // (b) improving but still breached — the prior corrective is moving the needle;
  //     give it time, suppress a fresh nudge (no re-firing alarm).
  if (deltaSeverity < -SETPOINT_NOISE_FLOOR) {
    return Object.freeze({
      disposition: 'improving',
      deltaSeverity,
      consecutiveWorseningTicks: 0,
      autoPromote: false,
      suppressNudge: true,
      nextState: Object.freeze({ priorBreachSeverity: current, consecutiveWorseningTicks: 0 }),
    });
  }

  // (c) worsening (or flat) past the streak floor despite an open corrective →
  //     auto-promote the rung. Flat counts toward the streak (the help isn't
  //     landing); strict improvement resets it above.
  const worseningNow = deltaSeverity > SETPOINT_NOISE_FLOOR || Math.abs(deltaSeverity) <= SETPOINT_NOISE_FLOOR;
  const streak = worseningNow ? prior.consecutiveWorseningTicks + 1 : 0;
  const autoPromote = worseningNow && hasOpenCorrective && streak >= floor;

  return Object.freeze({
    disposition: 'worsening',
    deltaSeverity,
    consecutiveWorseningTicks: streak,
    autoPromote,
    suppressNudge: false,
    nextState: Object.freeze({ priorBreachSeverity: current, consecutiveWorseningTicks: streak }),
  });
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
  // ── WIN-3: graded homeostatic controller (the routing layer) ──────────────
  /**
   * Resolves a commitment's REAL standing-drive context (driveId +
   * breachSeverity). When omitted the engine keeps its prior fabricated-severity
   * behaviour (no regression). The composition root binds this from the live
   * drive snapshot.
   */
  readonly driveContextResolver?: DriveContextResolver | null;
  /** driveId → its bound DRAFTER. The mid-rung corrective. Defaults to empty. */
  readonly drafterRegistry?: DrafterRegistry | null;
  /** The tenant delegation ceiling. Caps draft/delegate. Default 'delegate'. */
  readonly autonomyCap?: AutonomyCap;
  // ── WIN-4: closed-loop set-point regulation ───────────────────────────────
  /**
   * Round-trips the per-(tenant,driveId) regulation memory (priorBreachSeverity
   * + consecutiveWorseningTicks) through the situational-entity attributes jsonb.
   * When omitted the set-point arc is a no-op (the controller still nudges).
   */
  readonly setPointStore?: SetPointStateStore | null;
  /** Auto-promote after this many consecutive worsening ticks. Default 3. */
  readonly worseningTicksFloor?: number;
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
            driveContextResolver: deps.driveContextResolver ?? null,
            drafterRegistry: deps.drafterRegistry ?? null,
            autonomyCap: deps.autonomyCap ?? 'delegate',
            setPointStore: deps.setPointStore ?? null,
            worseningTicksFloor: deps.worseningTicksFloor ?? DEFAULT_WORSENING_TICKS_FLOOR,
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
  readonly driveContextResolver: DriveContextResolver | null;
  readonly drafterRegistry: DrafterRegistry | null;
  readonly autonomyCap: AutonomyCap;
  readonly setPointStore: SetPointStateStore | null;
  readonly worseningTicksFloor: number;
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

  // ── WIN-3/4: resolve the REAL standing-drive context (driveId +
  // breachSeverity) so the proposal carries true severity, the corrective is
  // graded to it, and the set-point arc can compare it to the prior tick.
  // Honest-degrade: a missing/throwing resolver → null → prior behaviour.
  const driveCtx = await safeResolveDriveContext(deps.driveContextResolver, c, deps.logger);

  // ── WIN-4: closed-loop set-point regulation — did the SET-POINT recover since
  // last tick? Run the delta-evaluator BEFORE deciding the corrective so its
  // verdict can suppress a redundant nudge (improving) or auto-promote the rung
  // (worsening). No-op when there is no drive context / no store.
  const setPoint = await runSetPointArc(driveCtx, deps);

  // someday class is reviewed, never auto-fired up the intrusive ladder.
  // It surfaces a review-only proposal and stays at rung 0.
  const reviewOnly = c.class === 'someday';

  // (b) improving-but-breached → the prior corrective is working; SUPPRESS a
  // fresh nudge this tick (continuity of care, not a re-firing alarm). The
  // commitment stays live; next tick re-checks recovery.
  if (setPoint?.suppressNudge && !reviewOnly) {
    return { surfaced: false, escalated: false, confirmed: false, reopened: false };
  }

  // ── RESURFACE through the existing gated proposal sink. ───────────────────
  let surfaced = false;
  try {
    const accepted = await deps.proposalSink.propose(toProposal(c, deps.nowMs, driveCtx));
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

  // ── WIN-3: graded corrective — when a real drive context is present, route the
  // corrective by TRUE severity through the CorrectiveLadderPolicy + drive→drafter
  // registry instead of the loudness-only ladder. severity<0.25 → nudge;
  // 0.25–0.6 → invoke the drive's drafter (DRAFT proposal row, HITL); ≥0.6 →
  // owner-direct safe-halt with the draft attached. (c) auto-promote bumps the
  // rung one step. The autonomy cap clamps draft/delegate.
  if (driveCtx) {
    const graded = await runGradedCorrective(c, driveCtx, setPoint, deps);
    return { surfaced, escalated: graded.escalated, confirmed: false, reopened: false };
  }

  // ── LADDER (fallback) — advance one rung (gated on ack); sovereign top rung =
  // safe-halt. Used when no drive context resolved (no regression for unbound
  // items).
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

/**
 * Map a commitment to an EstateProposal. WIN-3: when a real drive context is
 * present, the proposal carries the TRUE driveId + breachSeverity from the live
 * drive evaluator — NOT the prior fabricated `'royalty-currency'` / `c.sovereign
 * ? 1 : 0.6`. Without a drive context it honest-degrades to the legacy values so
 * unbound commitments still surface (no regression).
 */
function toProposal(
  c: MdCommitment,
  nowMs: number,
  driveCtx: DriveContext | null,
): EstateProposal {
  const breachSeverity = driveCtx ? clamp01(driveCtx.breachSeverity) : c.sovereign ? 1 : 0.6;
  // Sovereign obligations stay critical regardless of the measured severity (a
  // sovereign breach is never "low"); otherwise the urgency tracks severity.
  const urgency: EstateProposal['urgency'] = c.sovereign
    ? 'critical'
    : breachSeverity >= 0.6
      ? 'critical'
      : 'high';
  return Object.freeze({
    tenantId: c.tenantId,
    // Stable dedupe id — the same commitment coalesces across ticks.
    id: `commitment:${c.id}`,
    driveId: (driveCtx?.driveId ?? 'royalty-currency') as EstateProposal['driveId'],
    title: c.title,
    rationale: c.rationale,
    urgency,
    breachSeverity,
    evidenceEntityIds: c.evidenceIds,
    proposedAtMs: nowMs,
  });
}

/** Resolve the drive context, swallowing faults to `null` (honest-degrade). */
async function safeResolveDriveContext(
  resolver: DriveContextResolver | null,
  c: MdCommitment,
  logger: PinoLikeLogger,
): Promise<DriveContext | null> {
  if (!resolver) return null;
  try {
    return await resolver.resolve(c);
  } catch (err) {
    logger.warn(
      { commitmentId: c.id, err: errMsg(err) },
      'md-commitments: driveContextResolver failed (degraded to null)',
    );
    return null;
  }
}

/**
 * WIN-4 — run the set-point arc: read the prior regulation memory, evaluate the
 * delta against the current breachSeverity, and persist the next state. Returns
 * the verdict (or `null` when there is no drive context / no store). Best-effort:
 * a store fault degrades to `null` (the controller still nudges).
 */
async function runSetPointArc(
  driveCtx: DriveContext | null,
  deps: OneDeps,
): Promise<SetPointDelta | null> {
  if (!driveCtx || !deps.setPointStore) return null;
  try {
    const prior = await deps.setPointStore.read(deps.tenantId, driveCtx.driveId);
    const delta = evaluateSetPointDelta(prior, driveCtx.breachSeverity, {
      worseningTicksFloor: deps.worseningTicksFloor,
      hasOpenCorrective: true,
    });
    await deps.setPointStore.write(deps.tenantId, driveCtx.driveId, delta.nextState);
    return delta;
  } catch (err) {
    deps.logger.warn(
      { tenantId: deps.tenantId, driveId: driveCtx.driveId, err: errMsg(err) },
      'md-commitments: set-point arc failed (degraded — controller still nudges)',
    );
    return null;
  }
}

/**
 * WIN-3 — the graded homeostatic corrective. Selects the rung by TRUE severity
 * (clamped to the autonomy cap), auto-promotes one rung when the set-point is
 * worsening across the streak floor, and actuates the rung:
 *   - nudge    → the gated proposal already surfaced upstream; record the ladder.
 *   - draft    → invoke the drive's bound drafter to write a DRAFT proposal row.
 *   - delegate → owner-direct safe-halt with the draft attached (HITL park).
 * PROPOSE-ONLY throughout: a drafter writes a `proposed` inbox row, never
 * executes; delegate is the existing safe-halt dispatcher (surface + wait).
 */
async function runGradedCorrective(
  c: MdCommitment,
  driveCtx: DriveContext,
  setPoint: SetPointDelta | null,
  deps: OneDeps,
): Promise<{ readonly escalated: boolean }> {
  let rung = correctiveRungFor(driveCtx.breachSeverity, deps.autonomyCap);
  // (c) auto-promote: the set-point isn't recovering after an open corrective →
  // climb one rung (capped). Continuity of care: help escalates with the danger.
  if (setPoint?.autoPromote) {
    rung = promoteRung(rung, deps.autonomyCap);
  }

  let drafted = false;
  let draftRef: string | undefined;
  if (rung === 'draft' || rung === 'delegate') {
    const drafter = deps.drafterRegistry?.get(driveCtx.driveId) ?? null;
    if (drafter) {
      try {
        const out = await drafter(c, {
          tenantId: deps.tenantId,
          nowMs: deps.nowMs,
          breachSeverity: driveCtx.breachSeverity,
        });
        drafted = out.drafted;
        draftRef = out.draftRef;
      } catch (err) {
        // A drafter outage never breaks the sweep — fall through to the ladder
        // surface so the concern is still raised (just without the artifact).
        deps.logger.warn(
          { commitmentId: c.id, driveId: driveCtx.driveId, err: errMsg(err) },
          'md-commitments: drive drafter failed (swallowed — surfacing without draft)',
        );
      }
    }
  }

  // delegate = owner-direct safe-halt (the existing dispatcher). For a sovereign
  // commitment this is fail-closed surface-and-wait; the draft rides along as the
  // attached artifact. Both draft (artifact written) and delegate (safe-halt)
  // count as escalation for the sweep counters.
  const escalated = rung === 'delegate';
  try {
    if (rung === 'delegate') {
      await deps.ladderDispatchers.ownerDirectSafeHalt(c);
    } else if (rung === 'draft' && !drafted) {
      // No drafter bound (or it declined) → still surface louder than rung 0 so
      // the concern isn't silent: fire the in-app rung.
      await deps.ladderDispatchers.inApp(c);
    }
  } catch (err) {
    deps.logger.warn(
      { commitmentId: c.id, rung, err: errMsg(err) },
      'md-commitments: graded corrective dispatch failed (swallowed)',
    );
  }

  const hash = await safeAudit(deps.auditSink, {
    tenantId: deps.tenantId,
    commitmentId: c.id,
    transition: `corrective:${rung}:sev-${driveCtx.breachSeverity.toFixed(2)}${
      setPoint?.autoPromote ? ':auto-promoted' : ''
    }${drafted && draftRef ? `:draft-${draftRef}` : ''}`,
    sovereign: c.sovereign,
    occurredAtMs: deps.nowMs,
  });

  await deps.repo.transition(deps.tenantId, c.id, {
    status: 'overdue',
    attemptCount: c.attemptCount + 1,
    lastNudgedAt: new Date(deps.nowMs),
    auditChainHash: hash,
  });

  return { escalated };
}

function promoteRung(rung: CorrectiveRung, cap: AutonomyCap): CorrectiveRung {
  const next = RUNG_ORDER[RUNG_ORDER.indexOf(rung) + 1] ?? rung;
  return clampToCap(next, cap);
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
