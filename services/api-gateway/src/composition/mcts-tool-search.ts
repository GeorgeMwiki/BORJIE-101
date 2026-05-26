/**
 * mcts-tool-search — opt-in search-based reasoning wrapper for
 * high-leverage decisions.
 *
 * Companion to:
 *   - Docs/DESIGN/PRM_MCTS_REASONING_SPEC.md
 *   - packages/process-reward-model/
 *
 * Does NOT modify the existing brain-kernel-wiring. It exposes a single
 * factory `createMctsToolSearch` that the caller (today: the
 * regulatory-filing executor) explicitly invokes when the wall-clock
 * budget for a Tier-2 decision is justified. The autonomy-policy gate
 * is the ultimate authority on when MCTS may be invoked.
 *
 * Dependencies (injected; no module-level mutation):
 *   - PrmFn        — the active process reward model
 *   - ExpansionFn  — generates K candidate continuations from the LLM
 *   - SimulationStepFn — applies a step + returns the next state + obs
 *   - dispatcher   — replays the chosen path through the real tool
 *                    dispatcher so audit + RLS + approval-matrix engage
 *
 * The wrapper emits one MctsAuditPayload per invocation; the caller
 * threads it through `@borjie/audit-hash-chain.appendEntry`.
 */

import {
  DEFAULT_MCTS_BUDGET,
  buildMctsAuditPayload,
  searchDriver,
  type ExpansionFn,
  type MctsAuditPayload,
  type MctsBudget,
  type MctsSearchResult,
  type PrmContext,
  type PrmFn,
  type ReasoningState,
  type ReasoningStep,
  type SimulationStepFn,
} from '@borjie/process-reward-model';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface McstToolSearchIntent {
  readonly intentKind: string;
  readonly turnId: string;
}

export interface McstToolSearchInput {
  readonly intent: McstToolSearchIntent;
  readonly context: PrmContext;
  readonly budget?: Partial<MctsBudget>;
}

export interface DispatchedObservation {
  readonly stepId: string;
  readonly success: boolean;
  readonly summary: string;
  readonly schemaValid: boolean;
}

export interface DispatchedToolPath {
  readonly steps: ReadonlyArray<ReasoningStep>;
  readonly observations: ReadonlyArray<DispatchedObservation>;
  readonly success: boolean;
}

export interface SelectedToolPathOutcome {
  readonly searchResult: MctsSearchResult;
  readonly dispatchedPath: DispatchedToolPath;
  readonly auditPayload: MctsAuditPayload;
}

export interface ToolDispatcher {
  readonly replay: (
    path: ReadonlyArray<ReasoningStep>,
    context: PrmContext,
  ) => Promise<DispatchedToolPath>;
}

export interface McstToolSearchDeps {
  readonly prm: PrmFn;
  readonly expander: ExpansionFn;
  readonly stepFn: SimulationStepFn;
  readonly dispatcher: ToolDispatcher;
  readonly now?: () => number;
  readonly nowIso?: () => string;
  readonly hashPath?: (steps: ReadonlyArray<ReasoningStep>) => string;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers (pure)
// ────────────────────────────────────────────────────────────────────────

function defaultHashPath(steps: ReadonlyArray<ReasoningStep>): string {
  // Stable structural fingerprint — id sequence is enough for audit.
  // The full canonical-json hash lives in the audit-chain layer
  // upstream; this is only the per-search summary hash.
  if (steps.length === 0) return 'empty';
  return steps.map((s) => s.id).join('|');
}

function mergeBudget(partial: Partial<MctsBudget> | undefined): MctsBudget {
  if (!partial) return DEFAULT_MCTS_BUDGET;
  return Object.freeze({ ...DEFAULT_MCTS_BUDGET, ...partial });
}

function buildRootState(intentKind: string): ReasoningState {
  return Object.freeze({
    intentKind,
    steps: Object.freeze([]),
    observations: Object.freeze([]),
    depth: 0,
    terminal: false,
  });
}

// ────────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────────

export type McstToolSearchFn = (
  input: McstToolSearchInput,
) => Promise<SelectedToolPathOutcome>;

export function createMctsToolSearch(deps: McstToolSearchDeps): McstToolSearchFn {
  const now = deps.now ?? (() => Date.now());
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const hashPath = deps.hashPath ?? defaultHashPath;

  return async (input: McstToolSearchInput): Promise<SelectedToolPathOutcome> => {
    const budget = mergeBudget(input.budget);
    const rootState = buildRootState(input.intent.intentKind);

    const searchResult = searchDriver({
      rootState,
      prm: deps.prm,
      expander: deps.expander,
      step: deps.stepFn,
      context: input.context,
      budget,
      now,
    });

    const dispatchedPath = await deps.dispatcher.replay(
      searchResult.selectedPath,
      input.context,
    );

    const auditPayload = buildMctsAuditPayload({
      tenantId: input.context.tenantId,
      turnId: input.intent.turnId,
      intentKind: input.intent.intentKind,
      rolloutsRun: searchResult.rolloutsRun,
      bestValue: searchResult.bestValue,
      terminatedReason: searchResult.terminatedReason,
      selectedPathHash: hashPath(searchResult.selectedPath),
      treeSize: searchResult.nodes.length,
      wallMs: searchResult.wallMs,
      timestampIso: nowIso(),
    });

    return Object.freeze({
      searchResult,
      dispatchedPath,
      auditPayload,
    });
  };
}

// ────────────────────────────────────────────────────────────────────────
// Convenience surface — `mctsToolSearch(intent, ctx, budget) → path`
// matches the spec §4 signature for callers that already have a
// fully-bound factory and just want a one-shot.
// ────────────────────────────────────────────────────────────────────────

export async function mctsToolSearch(
  bound: McstToolSearchFn,
  intent: McstToolSearchIntent,
  context: PrmContext,
  budget?: Partial<MctsBudget>,
): Promise<SelectedToolPathOutcome> {
  return bound(
    budget === undefined
      ? { intent, context }
      : { intent, context, budget },
  );
}
