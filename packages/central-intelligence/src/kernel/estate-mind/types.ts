/**
 * EstateMind types — the resident per-tenant Slow Loop (Wave 1, organ #1;
 * `Docs/research/MD_COGNITIVE_KERNEL_ARCHITECTURE.md` §2.2).
 *
 * The Slow Loop runs PERCEIVE → ORIENT → evaluate-drives → emit-goals →
 * surface-as-PROPOSALS on its own heartbeat, holding the situational model
 * between ticks (the model IS the state). It is the structural fix for INV-D's
 * "continuous, structured cognitive cycle in the BACKEND."
 *
 * HARD RAILS encoded in these types:
 *   - The loop emits goals only as PROPOSALS through a {@link ProposalSink}; it
 *     has NO executor handle, so it CANNOT execute a sovereign/money/licence
 *     action. Those stay HITL forever.
 *   - The loop is ADDITIVE: nothing here is on the per-request `think(req)`
 *     path. It runs only when the api-gateway heartbeat (leader-elected,
 *     flag-gated) calls `tick`.
 */

import type { SituationalModel } from '../situational-model/situational-model.js';
import type { RecordEntityInput, SituationalSnapshot } from '../situational-model/types.js';
import type { MotivationEngine } from '../motivation/motivation-engine.js';
import type { DriveThresholds, MotivatedGoal } from '../motivation/types.js';

/**
 * PERCEIVE source — supplies the observations that refresh the situational
 * model for a tenant. Implementations read sensors / memory / read-models and
 * return entity observations. Returning `[]` is the normal idle case. The
 * source is PURE data: it never proposes or acts. Kept injectable so the loop
 * stays decoupled from the (separately wired) sensor stack and is unit-testable
 * with a stub.
 */
export interface PerceptionSource {
  perceive(input: {
    readonly tenantId: string;
    readonly nowMs: number;
  }): Promise<ReadonlyArray<RecordEntityInput>>;
}

/**
 * The gated proposal sink the loop emits goals through. The composition root
 * implements it over the EXISTING proactive sink (`NudgeRouter` →
 * `proactive_nudge` rows → owner inbox), so the loop reuses the one
 * already-gated delivery path — it never invents a new surface and never
 * bypasses the gate. Returns whether the proposal was accepted (deduped sinks
 * may drop a repeat within cooldown).
 */
export interface ProposalSink {
  propose(proposal: EstateProposal): Promise<boolean>;
}

/**
 * A proposal the resident mind surfaces to the owner — a "MD noticed X, here's
 * what I'd do" colleague-note. It is NEVER an executed action; the owner acts
 * (or the gated executor does, downstream, for reversible+granted work only).
 */
export interface EstateProposal {
  readonly tenantId: string;
  /** Stable dedupe id (coalesces the same concern across ticks). */
  readonly id: string;
  readonly driveId: MotivatedGoal['driveId'];
  readonly title: string;
  readonly rationale: string;
  readonly urgency: MotivatedGoal['urgency'];
  readonly breachSeverity: number;
  /** Entity ids that evidence the concern (Auditor evidence-required rail). */
  readonly evidenceEntityIds: ReadonlyArray<string>;
  readonly proposedAtMs: number;
}

/**
 * RECONCILE port — the DEFERRAL / FOLLOW-THROUGH engine seam.
 *
 * The kernel re-reads the WHOLE durable commitment backlog every tick (the
 * "never-drop-a-thread" sweep), but it does NOT itself own the durable store,
 * the WaitFor evaluator, the reminder ladder, or the safe-halt — those live in
 * the composition root (estate-mind-wiring.ts) so the kernel stays
 * dependency-light and unit-testable. This port is the single call the tick
 * makes between ORIENT and PROPOSE; the implementation:
 *
 *   1. re-reads all OPEN commitments for the tenant,
 *   2. recomputes due/overdue/blocked (time: dueAt<=now; event: eventKey fired;
 *      condition: predicate true / deadline passed),
 *   3. resurfaces due/overdue through the EXISTING dual proposal sink,
 *   4. advances the reminder ladder one rung (gated on acknowledgement),
 *   5. ESCALATES an overdue SOVEREIGN obligation to the HITL safe-halt
 *      (mwikila_actions_inbox) — it NEVER auto-actuates a sovereign action,
 *   6. closes a commitment ONLY on positive proof, else RE-OPENS it.
 *
 * FAIL-SAFE CONTRACT (mirrors the rest of the tick): `reconcile` MUST NOT
 * throw — a store fault degrades the tick (recorded in `degradedReason`) and
 * never breaks the EstateMind heartbeat. It is budget-bounded by the caller's
 * cadence; the implementation should itself be cheap per tick.
 */
export interface ReconciliationPort {
  reconcile(input: {
    readonly tenantId: string;
    readonly nowMs: number;
  }): Promise<ReconcileResult>;
}

/**
 * GAP-WATCH port — the Capability Gap Register's blocker-clear sweep (Loop A,
 * P0; `Docs/research/THE_METACOGNITIVE_SELF_MODEL.md` §3.4). Folded into the
 * RECONCILE step of the slow loop so the MD durably re-probes every open
 * capability gap each tick: read the live capability snapshot (registered
 * tools / wired organs / flags / approvals / evidence), evaluate each gap's
 * unblock trigger, and on a clear drive the verifier-gated auto-completion
 * (sovereign-parks, stale-resume-revalidates, no false-green).
 *
 * The kernel does NOT own the gap store, the snapshot source, the watcher, or
 * the auto-completer — those live in the composition root over
 * `md_commitments` + the tool registry + the Auditor. This port is the single
 * call the tick makes; the implementation is FAIL-SAFE (never throws to the
 * tick — a fault degrades the tick via `degradedReason`).
 */
export interface GapWatchPort {
  watch(input: {
    readonly tenantId: string;
    readonly nowMs: number;
  }): Promise<GapWatchSummary>;
}

/** Pure observability summary of one gap-watch sweep. Never thrown. */
export interface GapWatchSummary {
  /** Open capability gaps re-probed this tick. */
  readonly probed: number;
  /** Gaps whose blocker cleared this tick. */
  readonly cleared: number;
  /** Cleared gaps that auto-completed (verifier passed) this tick. */
  readonly completed: number;
  /** Cleared gaps reopened (verifier rejected / stale-resume) this tick. */
  readonly reopened: number;
  /** Sovereign gaps parked for four-eye approval this tick (never actuated). */
  readonly parkedSovereign: number;
  /** Set when the sweep degraded (and why); null on a clean sweep. */
  readonly degradedReason: string | null;
}

/** Pure observability summary of one reconcile sweep. Never thrown. */
export interface ReconcileResult {
  /** Live commitments re-read this tick. */
  readonly reviewed: number;
  /** Commitments flipped to due/overdue this tick. */
  readonly surfaced: number;
  /** Overdue SOVEREIGN obligations escalated to the HITL safe-halt. */
  readonly escalated: number;
  /** Commitments closed on positive proof this tick. */
  readonly confirmed: number;
  /** Unconfirmed commitments re-opened this tick (never-drop-a-thread). */
  readonly reopened: number;
  /** Set when the sweep degraded (and why); null on a clean sweep. */
  readonly degradedReason: string | null;
}

/** Per-tenant tick result — pure observability, never thrown. */
export interface EstateMindTickResult {
  readonly tenantId: string;
  readonly observed: number;
  readonly snapshot: SituationalSnapshot;
  readonly goalsFormulated: number;
  readonly proposalsEmitted: number;
  readonly pruned: number;
  /** RECONCILE summary for this tick; null when no reconcile port is wired. */
  readonly reconcile: ReconcileResult | null;
  /** GAP-WATCH summary for this tick; null when no gap-watch port is wired. */
  readonly gapWatch: GapWatchSummary | null;
  /** Set when the tick degraded (and why); null on a clean cycle. */
  readonly degradedReason: string | null;
}

/** Outcome of one heartbeat across a set of tenants. */
export interface EstateMindCycleResult {
  readonly tenants: number;
  readonly proposalsEmitted: number;
  readonly perTenant: ReadonlyArray<EstateMindTickResult>;
}

export interface EstateMindDeps {
  /** The standing situational model (write on PERCEIVE, read on ORIENT). */
  readonly situationalModel: SituationalModel;
  /** The motivation engine (evaluates drives → self-formulated goals). */
  readonly motivation: MotivationEngine;
  /** PERCEIVE source. When omitted the loop only re-evaluates existing state. */
  readonly perception?: PerceptionSource | null;
  /** The gated proposal sink. When omitted, goals are computed but not emitted. */
  readonly proposalSink?: ProposalSink | null;
  /**
   * RECONCILE port — the DEFERRAL / FOLLOW-THROUGH sweep (the "never-drop-a-
   * thread" engine). When omitted the tick runs exactly as before (the
   * deferral organ is purely additive). The implementation lives in the
   * composition root over the durable `md_commitments` store. Runs between
   * ORIENT and PROPOSE, fail-safe (never throws to the tick).
   */
  readonly reconciliation?: ReconciliationPort | null;
  /**
   * GAP-WATCH port — the Capability Gap Register's blocker-clear sweep (Loop A,
   * P0). Folded into the RECONCILE step. When omitted the tick runs exactly as
   * before (the gap register is purely additive). The implementation lives in
   * the composition root over `md_commitments` + the tool registry + the
   * Auditor. Runs inside RECONCILE, fail-safe (never throws to the tick).
   */
  readonly gapWatch?: GapWatchPort | null;
  /**
   * Per-tenant schema-conditioned threshold resolver (Wave-D C2). When wired,
   * the tick resolves THIS tenant's `DriveThresholds` (the consolidated
   * `baseline:*` band — mean ± k·sd) BEFORE evaluating drives and passes them
   * as the per-call override into `motivation.formulateGoals(snapshot, …)`, so
   * a breach fires on what is anomalous for THIS estate, not a global static
   * floor. When omitted (or it resolves `null`/throws) the tick honest-degrades
   * to the construction-time defaults — exactly today's behaviour. The
   * implementation lives in the composition root over the consolidated baseline
   * facts; the kernel stays dependency-light.
   *
   * FAIL-SAFE: the resolver is invoked inside a guard — a fault or a `null`
   * result simply omits the override (default thresholds), never breaks the
   * tick.
   */
  readonly thresholdsResolver?:
    | ((tenantId: string) => Promise<DriveThresholds | null>)
    | null;
  /** Injectable clock for deterministic ticks. */
  readonly now?: () => number;
  /**
   * Idle span (ms) after which a cold entity may be pruned. Only prunes when
   * the situational model's retrieval threshold is finite (opt-in). Default
   * 30 days. A SAFETY bound on memory growth, not a capability cap.
   */
  readonly pruneIdleMs?: number;
  readonly logger?: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}
