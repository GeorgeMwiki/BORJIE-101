/**
 * DecisionTrace types — ported from LITFIN observability.
 *
 * A DecisionTrace is the unit-of-explanation a human auditor cares about:
 *   "Why did the brain refuse to draft this lease?"
 *   "Why was this payout flagged?"
 *
 * It sits ON TOP of raw OTel spans + Langfuse traces. A trace captures:
 *   - inputs the decision saw
 *   - the alternative BRANCHES considered (with rationale each)
 *   - which branch was CHOSEN (and why)
 *   - the final OUTPUT and outcome
 *
 * Compared to a flat list of "stage" events from the brain kernel's
 * 13-step pipeline, this gives auditors / debug UIs a structured
 * narrative — they can replay a decision and immediately see the
 * counterfactual ("what if the brain had picked branch B instead?").
 *
 * Design constraints (locked by tests):
 *   1. Once `finalize()` is called the snapshot is FROZEN. Any attempt
 *      to mutate via the live handle throws.
 *   2. JSON-serializable end-to-end — `structuredClone(snapshot)` must
 *      succeed so traces can be persisted to Postgres / pushed to
 *      Langfuse / posted to a debug UI without bespoke serialisers.
 *   3. OTel-agnostic — if `@opentelemetry/api` is not resolvable the
 *      otel-bridge is a no-op. Decision logic NEVER breaks because OTel
 *      misbehaved.
 *   4. No-decision is a valid decision — `finalize()` with zero branches
 *      is allowed (e.g. brain decided the input was malformed and bailed
 *      before considering options).
 *
 * @module packages/observability/src/decision-trace/types
 */

/**
 * One alternative branch the decision considered. Branches are recorded
 * in the order they were evaluated so the auditor can see the brain's
 * train-of-thought; the chosen branch is marked separately on the trace
 * itself (NOT on the branch — keeps the branch record self-contained
 * and makes "branches considered" trivial to enumerate).
 */
export interface DecisionBranch {
  /** Branch identifier, unique within this trace. */
  readonly id: string;
  /** Short human-readable label e.g. "draft_lease" / "refuse". */
  readonly label: string;
  /** Why this branch was considered or rejected. */
  readonly rationale: string;
  /** Confidence in (0,1] — optional; absent means "not scored". */
  readonly score?: number;
  /** Free-form structured metadata. MUST be JSON-clonable. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Wall-clock when this branch was added (ISO 8601). */
  readonly recordedAt: string;
}

/**
 * Context attached to every trace. Mirrors the standard request scope
 * BORJIE observability tracks (tenant + user + correlation), plus
 * a couple of decision-specific fields.
 */
export interface DecisionTraceContext {
  /** Tenant the decision was made for. */
  readonly tenantId?: string;
  /** End-user / actor on whose behalf the decision ran. */
  readonly userId?: string;
  /** Request/correlation id so the trace joins to API logs. */
  readonly requestId?: string;
  /** Optional parent trace id — set when this trace is nested inside another. */
  readonly parentTraceId?: string;
  /** Free-form structured metadata. MUST be JSON-clonable. */
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/**
 * The mutable live handle returned by `startDecisionTrace`. Once
 * `finalize()` is called the handle becomes "spent" — further mutations
 * MUST throw.
 *
 * The fluent surface is intentionally small (addBranch / choose /
 * finalize / addAttribute) — anything more elaborate goes through the
 * underlying finalised snapshot.
 */
export interface DecisionTrace {
  readonly traceId: string;
  readonly name: string;
  readonly startedAt: string;
  /** Record a branch the decision considered. */
  addBranch(branch: Omit<DecisionBranch, 'recordedAt'>): void;
  /** Mark one of the previously-added branches as the chosen one. */
  choose(branchId: string, rationale?: string): void;
  /** Attach a key/value to the trace context after creation. */
  addAttribute(key: string, value: unknown): void;
  /**
   * Close the trace. `output` is the final decision payload (e.g. the
   * lease draft, or `{ refused: true, reason: '…' }`). `outcome` is a
   * coarse-grained outcome enum for filtering in dashboards.
   *
   * Subsequent calls to addBranch / choose / addAttribute / finalize
   * MUST throw.
   */
  finalize(args: {
    outcome: DecisionOutcome;
    output?: unknown;
    error?: string;
  }): DecisionTraceFinalised;
  /** True once `finalize()` has been called. */
  readonly isFinalised: () => boolean;
}

/**
 * Coarse-grained outcomes for dashboard filtering. Mirrors the LITFIN
 * span outcome enum but expanded to cover the BORJIE brain's
 * "refused" path (which is a deliberate non-action, not an error).
 */
export type DecisionOutcome =
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'refused'
  | 'failed';

/**
 * Frozen snapshot returned by `finalize`. This is the shape persisted
 * to the trace store + shipped to debug UIs + (when present) attached
 * to the active OTel span as events.
 *
 * `structuredClone(finalised)` MUST succeed — no class instances,
 * functions, or symbols allowed in any nested field.
 */
export interface DecisionTraceFinalised {
  readonly traceId: string;
  readonly name: string;
  readonly startedAt: string;
  readonly finalisedAt: string;
  readonly durationMs: number;
  readonly context: DecisionTraceContext;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly branches: ReadonlyArray<DecisionBranch>;
  readonly chosenBranchId: string | null;
  readonly chosenRationale: string | null;
  readonly outcome: DecisionOutcome;
  readonly output: unknown;
  readonly error: string | null;
}

/** Error thrown when a finalised trace is mutated. */
export class DecisionTraceFinalisedError extends Error {
  constructor(traceId: string, attemptedOp: string) {
    super(
      `DecisionTrace ${traceId} is finalised; cannot ${attemptedOp}.`,
    );
    this.name = 'DecisionTraceFinalisedError';
  }
}

/** Error thrown when `choose` references a branch that was never added. */
export class DecisionTraceUnknownBranchError extends Error {
  constructor(traceId: string, branchId: string) {
    super(
      `DecisionTrace ${traceId}: branch '${branchId}' was never added.`,
    );
    this.name = 'DecisionTraceUnknownBranchError';
  }
}
