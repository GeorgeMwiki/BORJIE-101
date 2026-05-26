/**
 * `@borjie/process-reward-model` — public surface.
 *
 * Process Reward Model + Monte Carlo Tree Search search-based reasoning
 * engine. Closes P0 #1 from the 18BB gap analysis. Companion to
 * `Docs/DESIGN/PRM_MCTS_REASONING_SPEC.md`.
 *
 * Six functional groups:
 *   1. Types — PRM input/output, MCTS node + budget, training records.
 *   2. PRM   — heuristic, learned-stub, aggregator.
 *   3. MCTS  — tree-node + UCB1 + expansion + simulation + backprop + driver.
 *   4. Training — example recorder + label collector.
 *   5. Audit — chain link builder.
 *   6. Defaults — DEFAULT_MCTS_BUDGET (re-exported).
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  ExpansionFn,
  MctsAuditPayload,
  MctsBudget,
  MctsNode,
  MctsSearchResult,
  MctsTerminationReason,
  Observation,
  PrmContext,
  PrmFn,
  PrmInput,
  PrmOutput,
  PrmSignal,
  PrmTrainingExample,
  ReasoningState,
  ReasoningStep,
  ReasoningTraceRecord,
  SimulationStepFn,
} from './types.js';

export { DEFAULT_MCTS_BUDGET } from './types.js';

// ── PRM ──────────────────────────────────────────────────────────────
export { heuristicPrm } from './prm/heuristic-prm.js';
export {
  createLearnedPrmStub,
  loadLearnedPrm,
  LEARNED_PRM_MIN_TRAINING_FLOOR,
  type LearnedPrmHandle,
} from './prm/learned-prm-stub.js';
export {
  createAggregatorPrm,
  AGGREGATOR_LEARNED_CONFIDENCE_FLOOR,
} from './prm/prm-aggregator.js';

// ── MCTS ─────────────────────────────────────────────────────────────
export {
  createRootNode,
  createChildNode,
  withAddedChild,
  withBackpropagatedValue,
} from './mcts/tree-node.js';
export { ucb1Score, selectByUcb1 } from './mcts/ucb1-selector.js';
export {
  expandWithScoring,
  type ScoredCandidate,
} from './mcts/expansion-policy.js';
export { rollout, type RolloutOutcome } from './mcts/simulation.js';
export {
  backpropagatePath,
  type NodeMap,
} from './mcts/backpropagation.js';
export {
  searchDriver,
  type SearchDriverInput,
} from './mcts/search-driver.js';

// ── Training ─────────────────────────────────────────────────────────
export {
  buildReasoningTraceRecord,
  type ReasoningTraceDraft,
} from './training/example-recorder.js';
export {
  collectLabeledExamples,
  type LabelCollectorInput,
  type StepCompletionRatio,
} from './training/label-collector.js';

// ── Audit ────────────────────────────────────────────────────────────
export {
  buildMctsAuditPayload,
  type BuildMctsAuditPayloadInput,
} from './audit/audit-chain-link.js';
