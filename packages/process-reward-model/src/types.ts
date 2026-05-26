/**
 * `@borjie/process-reward-model` — public types.
 *
 * Companion to Docs/DESIGN/PRM_MCTS_REASONING_SPEC.md. The contract is
 * intentionally narrow so multiple PRM implementations (heuristic, learned,
 * hybrid) can plug into the same MCTS search driver without modifying it.
 *
 * Conventions:
 *   - All public types are `readonly` end-to-end. Mutation is banned per
 *     the global coding-style rules; the MCTS implementation produces new
 *     state objects rather than mutating existing ones.
 *   - Numeric reward signals live in `[0, 1]`. Implementations that emit
 *     out-of-range values must clamp before returning.
 *   - PRM scores are NOT outcome judgements. They are *step-quality*
 *     estimates — the Math-Shepherd / OpenAI PRM800K framing.
 */

// ────────────────────────────────────────────────────────────────────────
// ReasoningStep + ReasoningState
// ────────────────────────────────────────────────────────────────────────

/**
 * A single candidate continuation from a `ReasoningState`. In the LLM-
 * tool-call setting this is a proposed tool invocation (tool name + redacted
 * args). The action descriptor is canonical — raw LLM output is held
 * elsewhere; this is the audit-safe projection.
 */
export interface ReasoningStep {
  readonly id: string;
  readonly kind: 'tool_call' | 'cite_lookup' | 'sub_question' | 'commit';
  readonly toolName: string | null;
  readonly args: Readonly<Record<string, unknown>>;
  readonly rationale: string;
}

/**
 * Accumulated trajectory from the root through the current decision point.
 * Immutable — every expansion creates a new `ReasoningState` rather than
 * mutating an existing one.
 */
export interface ReasoningState {
  readonly intentKind: string;
  readonly steps: ReadonlyArray<ReasoningStep>;
  readonly observations: ReadonlyArray<Observation>;
  readonly depth: number;
  readonly terminal: boolean;
}

/**
 * The observation returned after a step is *committed* to the dispatcher.
 * During simulation we synthesise stub observations; during replay we
 * persist the real observation from the tool dispatcher.
 */
export interface Observation {
  readonly stepId: string;
  readonly success: boolean;
  readonly summary: string;
  readonly schemaValid: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// PRM contract
// ────────────────────────────────────────────────────────────────────────

/**
 * Per-tenant context every PRM implementation receives. Carries the
 * domain hints (which jurisdiction, which filing kind) used by the
 * heuristic signals, plus the autonomy + killswitch state so policy-
 * aligned scoring can hard-zero forbidden actions.
 */
export interface PrmContext {
  readonly tenantId: string;
  readonly scopeKind: string | null;
  readonly scopeId: string | null;
  readonly autonomyTier: 1 | 2 | 3;
  readonly killswitchActive: boolean;
  readonly domainHints: Readonly<Record<string, string>>;
}

export interface PrmInput {
  readonly state: ReasoningState;
  readonly candidateStep: ReasoningStep;
  readonly context: PrmContext;
}

/**
 * A single named signal contributing to the aggregate PRM score. The
 * heuristic PRM emits 5 (cite_presence, compliance_precondition,
 * math_check, schema_validity, policy_alignment); learned PRMs emit
 * `learned_head` plus optional secondary heads.
 */
export interface PrmSignal {
  readonly name: string;
  readonly score: number;
  readonly weight: number;
  readonly explanation: string;
}

export interface PrmOutput {
  readonly score: number;
  readonly confidence: number;
  readonly signals: ReadonlyArray<PrmSignal>;
  readonly explanation: string;
}

/**
 * Pure function — the public PRM contract. No I/O, no mutation. The
 * heuristic + learned + aggregated PRMs all satisfy this signature so
 * they're trivially substitutable.
 */
export type PrmFn = (input: PrmInput) => PrmOutput;

// ────────────────────────────────────────────────────────────────────────
// MCTS contract
// ────────────────────────────────────────────────────────────────────────

export interface MctsNode {
  readonly id: string;
  readonly state: ReasoningState;
  readonly parentId: string | null;
  readonly incomingStep: ReasoningStep | null;
  readonly priorScore: number;
  readonly visits: number;
  readonly meanValue: number;
  readonly children: ReadonlyArray<string>;
}

export interface MctsBudget {
  readonly rollouts: number;
  readonly maxDepth: number;
  readonly maxWidth: number;
  readonly maxWallMs: number;
  readonly explorationC: number;
  readonly minVisitShare: number;
  readonly minQValue: number;
}

export const DEFAULT_MCTS_BUDGET: MctsBudget = Object.freeze({
  rollouts: 16,
  maxDepth: 4,
  maxWidth: 4,
  maxWallMs: 10000,
  explorationC: Math.SQRT2,
  minVisitShare: 0.6,
  minQValue: 0.8,
});

export type MctsTerminationReason =
  | 'budget_exhausted'
  | 'confident_root_choice'
  | 'wall_clock_exceeded'
  | 'no_expansion_possible';

export interface MctsSearchResult {
  readonly rootId: string;
  readonly nodes: ReadonlyArray<MctsNode>;
  readonly selectedPath: ReadonlyArray<ReasoningStep>;
  readonly terminatedReason: MctsTerminationReason;
  readonly rolloutsRun: number;
  readonly wallMs: number;
  readonly bestValue: number;
}

/**
 * Pluggable expansion policy — generates K candidate next-steps from a
 * given parent state. In production this calls the LLM with sampling
 * temperature > 0; in tests a deterministic stub is supplied.
 */
export type ExpansionFn = (
  parent: ReasoningState,
  width: number,
  context: PrmContext,
) => ReadonlyArray<ReasoningStep>;

/**
 * Pluggable simulation step — applies a step to a state and yields the
 * resulting (state, observation) pair. During real search this calls the
 * tool dispatcher in a sandbox; during tests it's pure.
 */
export type SimulationStepFn = (
  state: ReasoningState,
  step: ReasoningStep,
  context: PrmContext,
) => {
  readonly nextState: ReasoningState;
  readonly observation: Observation;
};

// ────────────────────────────────────────────────────────────────────────
// Training capture
// ────────────────────────────────────────────────────────────────────────

export interface ReasoningTraceRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly intentKind: string;
  readonly trajectory: ReadonlyArray<{
    readonly step: ReasoningStep;
    readonly observation: Observation | null;
  }>;
  readonly outcomeLabel: 0 | 1 | null;
  readonly outcomeSource: 'regulator_portal' | 'payment' | 'human' | null;
  readonly capturedAt: string;
  readonly labeledAt: string | null;
  readonly auditHash: string;
}

export interface PrmTrainingExample {
  readonly id: string;
  readonly tenantId: string;
  readonly traceId: string;
  readonly state: ReasoningState;
  readonly step: ReasoningStep;
  readonly label: 0 | 1;
  readonly completerAgreementRatio: number;
  readonly derivedAt: string;
  readonly auditHash: string;
}

// ────────────────────────────────────────────────────────────────────────
// Audit-chain link
// ────────────────────────────────────────────────────────────────────────

export interface MctsAuditPayload {
  readonly kind: 'mcts_reasoning_search';
  readonly payload: {
    readonly tenant_id: string;
    readonly turn_id: string;
    readonly intent_kind: string;
    readonly rollouts_run: number;
    readonly best_value: number;
    readonly terminated_reason: MctsTerminationReason;
    readonly selected_path_hash: string;
    readonly tree_size: number;
    readonly wall_ms: number;
    readonly timestamp_iso: string;
  };
}
