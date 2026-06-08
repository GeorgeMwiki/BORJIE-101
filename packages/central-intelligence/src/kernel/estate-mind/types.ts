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
import type { MotivatedGoal } from '../motivation/types.js';

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

/** Per-tenant tick result — pure observability, never thrown. */
export interface EstateMindTickResult {
  readonly tenantId: string;
  readonly observed: number;
  readonly snapshot: SituationalSnapshot;
  readonly goalsFormulated: number;
  readonly proposalsEmitted: number;
  readonly pruned: number;
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
