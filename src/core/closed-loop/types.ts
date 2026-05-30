/**
 * Closed-Loop Process Layer — Shared types.
 *
 * Every key Borjie operation runs inside a closed loop:
 *
 *   observe -> decide -> act -> measure -> adjust
 *
 * Each tick is one revolution. The tick is persisted to
 * `closed_loop_ticks` and the loop's running state lives in
 * `closed_loops`. Adjustments produced during `adjust()` land in
 * `closed_loop_adjustments` so the auditor can read the loop's history
 * (when did it tighten a threshold, why, what data drove the choice).
 *
 * The pattern is intentionally minimal: a `ClosedLoop` is a record of
 * five pure functions. The runtime threads context, persists rows, and
 * enforces the hard rules (tier-policy on act, DecisionTrace on
 * decide, AbortController budget). Loop authors only think about the
 * five steps.
 *
 * @module core/closed-loop/types
 */

import type { AnyBorjieTier } from "@/core/governance/tier-policy";

// ---------------------------------------------------------------------------
// Identifiers + scope
// ---------------------------------------------------------------------------

/** Stable, kebab-case identifier for a registered closed loop. */
export type ClosedLoopId =
  | "borrower-acquisition"
  | "kyc-verification"
  | "credit-scoring"
  | "disbursement"
  | "repayment-tracking"
  | "collections"
  | "regulator-reporting"
  | "cbr-filing"
  | "officer-utilisation"
  | "borrower-retention"
  | "complaint-resolution"
  | "learning-progress"
  | "community-lending"
  | "cross-org-pattern-mining"
  | "model-drift-watch";

/** Loop scope; identical shape to a sub-MD scope so loops can wrap sub-MDs cleanly. */
export interface ClosedLoopScope {
  readonly orgId: string;
  readonly borrowerId?: string;
  readonly applicationId?: string;
  readonly tier: AnyBorjieTier;
}

// ---------------------------------------------------------------------------
// Five step data shapes
// ---------------------------------------------------------------------------

/**
 * Output of `observe()`. A snapshot of the world the loop just read.
 * The runtime persists this verbatim onto the tick row so the loop is
 * fully replayable.
 */
export interface Observation {
  readonly observedAtMs: number;
  readonly facts: Readonly<Record<string, unknown>>;
  /** Optional summary the dashboard can show without parsing facts. */
  readonly summary?: string;
}

/**
 * Output of `decide()`. The decision must carry an action type so the
 * runtime can route into the tier-policy assertion before `act()`
 * fires. The runtime always wraps `decide()` in a DecisionTrace.
 */
export interface Decision {
  readonly actionType: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly predicted: Prediction;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * The metric the loop expects to move + by how much. We persist this
 * so `measure()` can compute actual-vs-predicted error per tick.
 */
export interface Prediction {
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
}

/** One side-effect emitted by `act()`. */
export interface Action {
  readonly type: string;
  readonly target?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Did the side-effect succeed when the runtime executed it? */
  readonly executed: boolean;
  readonly executionError?: string;
}

/**
 * Output of `measure()`. Compares the observation taken at the start of
 * the next tick (or a deferred measurement window) to the prediction
 * the prior decision committed to.
 */
export interface Measurement {
  readonly measuredAtMs: number;
  readonly metric: string;
  readonly predictedValue: number;
  readonly actualValue: number;
  readonly unit: string;
  /** Signed error; positive = we under-predicted. */
  readonly error: number;
  /** Tier-policy outcome the act produced. */
  readonly slaStatus: "within" | "breached" | "unknown";
}

/**
 * Output of `adjust()`. Free-shape; runtime persists every adjustment
 * row keyed by tick. Typical shapes:
 *   { kind: "threshold-tighten", from: 0.7, to: 0.75 }
 *   { kind: "model-swap", from: "haiku", to: "sonnet" }
 *   { kind: "lesson", note: "...", confidenceDelta: 0.3 }
 */
export interface Adjustment {
  readonly kind: string;
  readonly description: string;
  readonly delta?: Readonly<Record<string, unknown>>;
  /** If the adjustment writes a belief, the convince-loop delta. */
  readonly beliefDelta?: number;
}

// ---------------------------------------------------------------------------
// Loop contract
// ---------------------------------------------------------------------------

/**
 * The five functions a loop author writes. Each step receives the loop
 * context so it can read configuration without reaching for module-
 * global state.
 */
export interface ClosedLoopContext {
  readonly loopId: ClosedLoopId;
  readonly scope: ClosedLoopScope;
  readonly nowMs: number;
  readonly correlationId: string;
  /** Cooperative cancellation — every step checks between expensive
   *  operations. The runtime races against an `AbortController` budget. */
  readonly abortSignal?: AbortSignal;
}

export interface ClosedLoopSteps {
  observe(ctx: ClosedLoopContext): Promise<Observation>;
  decide(obs: Observation, ctx: ClosedLoopContext): Promise<Decision>;
  act(
    decision: Decision,
    ctx: ClosedLoopContext,
  ): Promise<ReadonlyArray<Action>>;
  measure(
    decision: Decision,
    actions: ReadonlyArray<Action>,
    ctx: ClosedLoopContext,
  ): Promise<Measurement>;
  adjust(
    measurement: Measurement,
    ctx: ClosedLoopContext,
  ): Promise<ReadonlyArray<Adjustment>>;
}

/**
 * The registered loop definition. The runtime composes `ClosedLoopSteps`
 * with config to run a tick.
 */
export interface ClosedLoopDefinition extends ClosedLoopSteps {
  readonly id: ClosedLoopId;
  readonly displayName: string;
  readonly description: string;
  /** Default scope tier; per-tick scope may override. */
  readonly defaultTier: AnyBorjieTier;
  /** Hard cap on a single tick. */
  readonly maxDurationMs: number;
  /** Cooldown between tick attempts. */
  readonly minIntervalMinutes: number;
  /** Tier-policy action the runtime asserts before invoking `act()`. */
  readonly actAction: string;
}

// ---------------------------------------------------------------------------
// Tick + persistence shapes
// ---------------------------------------------------------------------------

/** Output of one full revolution. Persisted to `closed_loop_ticks`. */
export interface ClosedLoopTick {
  readonly tickId: string;
  readonly loopId: ClosedLoopId;
  readonly scope: ClosedLoopScope;
  readonly correlationId: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly observation: Observation;
  readonly decision: Decision;
  readonly actions: ReadonlyArray<Action>;
  readonly measurement: Measurement;
  readonly adjustments: ReadonlyArray<Adjustment>;
  readonly decisionTraceId: string;
  readonly outcome: ClosedLoopOutcome;
}

export type ClosedLoopOutcome =
  | "success"
  | "aborted"
  | "sla-breach"
  | "action-error"
  | "internal-error";

/** Long-lived per-loop state row in `closed_loops`. */
export interface ClosedLoopState {
  readonly loopId: ClosedLoopId;
  readonly scope: ClosedLoopScope;
  readonly lastTickId: string | null;
  readonly lastTickAtMs: number | null;
  readonly lastOutcome: ClosedLoopOutcome | null;
  /** Rolling drift indicator computed by `measure()` over a window. */
  readonly driftSigma: number;
  /** Successful ticks in the last 30 days. */
  readonly successCount30d: number;
  /** SLA breaches in the last 30 days. */
  readonly breachCount30d: number;
}
