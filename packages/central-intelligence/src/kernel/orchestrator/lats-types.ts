/**
 * LATS (Language Agent Tree Search) — type contracts.
 *
 * Reference: Zhou et al., "Language Agent Tree Search Unifies Reasoning,
 * Acting, and Planning in Language Models" (ICML 2024). MCTS over LLM
 * rollouts with UCT/UCB1 selection, value backpropagation with discount,
 * and self-reflection at failed sub-trees.
 *
 * Coexists with the beam-search ToT planner in `search-planner.ts`. Where
 * the ToT planner discards everything outside the beam, LATS retains the
 * full tree, lets UCB1 dictate exploration/exploitation balance, and
 * backpropagates leaf scores up the parent chain (with a discount γ) so
 * that ancestors of strong leaves become attractive selection targets in
 * subsequent iterations.
 *
 * Types live here, not in `lats-search.ts`, so admin dashboards,
 * telemetry, and API routes can import the contract without dragging in
 * the search implementation graph.
 */

import type { Thought, PlanContext } from './search-planner.js';

// ─────────────────────────────────────────────────────────────────────
// Node primitives
// ─────────────────────────────────────────────────────────────────────

/**
 * One node in the LATS tree. Read-side immutable; the search loop builds
 * fresh node objects and writes them back into the internal node map so
 * upstream callers (debug UIs, telemetry) can walk the tree without
 * worrying about concurrent mutation.
 *
 * @property id            Globally unique within one `latsSearch` call.
 * @property thought       The {@link Thought} this node represents.
 *                         Re-uses the existing ToT contract so callers
 *                         can swap planners without reshaping data.
 * @property parentId      `null` only for the root.
 * @property childrenIds   Child node ids (lookup against the tree map).
 *                         Empty until the node is expanded.
 * @property value         Accumulated reward across all rollouts that
 *                         passed through this node. Divide by `visits`
 *                         for the running average.
 * @property visits        Visit count — how many rollouts touched the
 *                         node. 0 for never-visited (UCB1 treats these
 *                         as infinity, ensuring every child is tried at
 *                         least once before exploitation kicks in).
 * @property ucb           Cached UCB1 score from the most recent
 *                         selection round. Purely informational —
 *                         callers reading the tree post-hoc can use it
 *                         for debug visualisation. The search loop
 *                         recomputes UCB1 every iteration.
 * @property failed        True when the evaluator threw on this node.
 *                         The search loop skips failed nodes during
 *                         selection but still keeps them in the tree
 *                         for caller introspection.
 * @property reflection    Optional reflection text — populated when the
 *                         self-reflection heuristic fires (all children
 *                         scored below `reflectionThreshold`).
 */
export interface LatsNode {
  readonly id: string;
  readonly thought: Thought;
  readonly parentId: string | null;
  readonly childrenIds: ReadonlyArray<string>;
  readonly value: number;
  readonly visits: number;
  readonly ucb: number;
  readonly failed: boolean;
  readonly reflection: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Result envelope
// ─────────────────────────────────────────────────────────────────────

/**
 * Output of one `latsSearch` call.
 *
 * @property bestPath       Thought IDs from root → highest-average-value
 *                          leaf. Length `1 + depthOfBest`. The root id
 *                          is always element 0.
 * @property bestScore      Average value of the leaf at the tail of
 *                          `bestPath` (or its raw score if it was never
 *                          visited).
 * @property tree           Root of the explored tree. Callers can walk
 *                          it via `childrenIds`, looking nodes up in
 *                          `nodesById`.
 * @property nodesById      Flat map of every node the search created.
 *                          Lets callers walk the tree without rebuilding
 *                          parent/child relationships.
 * @property reflections    Reflections emitted during the search, in
 *                          the order they fired. Each entry is keyed by
 *                          the failing parent's node id so callers can
 *                          attribute lessons to specific sub-trees.
 * @property iterationsUsed How many MCTS iterations the search actually
 *                          ran (≤ `options.maxIterations`).
 * @property expansionsUsed How many expander calls were made. Bounded by
 *                          `HARD_MAX_EXPANSIONS` (same constant as ToT).
 * @property tokensUsed     Estimated tokens consumed via
 *                          `ESTIMATED_TOKENS_PER_EXPANSION * expansions`.
 *                          Bounded by `options.budgetTokens`.
 * @property pruned         Children dropped (evaluator throws, dup
 *                          content). Same accounting shape as ToT for
 *                          consistency across planners.
 */
export interface LatsResult {
  readonly bestPath: ReadonlyArray<string>;
  readonly bestScore: number;
  readonly tree: LatsNode;
  readonly nodesById: ReadonlyMap<string, LatsNode>;
  readonly reflections: ReadonlyArray<LatsReflection>;
  readonly iterationsUsed: number;
  readonly expansionsUsed: number;
  readonly tokensUsed: number;
  readonly pruned: number;
}

/**
 * A self-reflection record. Emitted when every child of `parentId`
 * scored below `options.reflectionThreshold` — the search loop treats
 * the sub-tree as a "failed branch" and records *why* (which thoughts
 * fell short, the threshold, and a synthesised lesson) so the caller
 * can stitch it into the planner's reflexion memo for the next pass.
 */
export interface LatsReflection {
  readonly parentId: string;
  readonly parentContent: string;
  readonly failedChildIds: ReadonlyArray<string>;
  readonly lesson: string;
  readonly threshold: number;
}

// ─────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────

/**
 * Caller-supplied evaluator. Same shape as the ToT planner so existing
 * scoring code drops in unchanged. Implementations MUST return a value
 * in [0, 1]; the search clamps defensively as defence-in-depth.
 */
export type LatsEvaluator = (
  thought: Thought,
  context: PlanContext,
) => Promise<number>;

/**
 * Caller-supplied expander. Same shape as the ToT planner. Returning an
 * empty array signals "this branch is a dead end" — the search marks
 * the parent terminal and moves on.
 */
export type LatsExpander = (
  thought: Thought,
  k: number,
) => Promise<ReadonlyArray<Thought>>;

/**
 * Options for `latsSearch`. Sensible defaults are exposed below.
 *
 * The two key knobs that differentiate LATS from the ToT planner:
 *  - `ucbConstant`         (exploration weight in UCB1, default √2)
 *  - `discount`            (γ — backprop reward decay per ancestor)
 *  - `reflectionThreshold` (children all below this → emit reflection)
 *
 * `maxIterations` is the OUTER loop budget — one iteration = one
 * select → expand → evaluate → backprop cycle. The expander/evaluator
 * are still subject to `HARD_MAX_EXPANSIONS` (50) and `budgetTokens`
 * (25K) inherited from the ToT planner so the two planners are
 * cost-comparable in A/B tests.
 */
export interface LatsOptions {
  readonly evaluator: LatsEvaluator;
  readonly expander: LatsExpander;
  readonly maxIterations?: number;
  readonly maxDepth?: number;
  readonly branchingFactor?: number;
  readonly ucbConstant?: number;
  readonly discount?: number;
  readonly reflectionThreshold?: number;
  readonly earlyExitScore?: number;
  readonly budgetTokens?: number;
  readonly idGenerator?: () => string;
  /**
   * Injectable PRNG — used only as a tie-breaker when two children have
   * the exact same UCB1 score. Defaults to a deterministic mulberry32
   * seeded with 0 so identical inputs produce identical trees (the
   * caller can override for true randomness when they care).
   */
  readonly random?: () => number;
}

// ─────────────────────────────────────────────────────────────────────
// Defaults — exported so callers + tests can read the canonical numbers.
// ─────────────────────────────────────────────────────────────────────

/** Default outer-loop iteration budget. */
export const DEFAULT_MAX_ITERATIONS = 16;
/** Default search depth (root is depth 0, so 4 means 4 expansion layers). */
export const DEFAULT_MAX_DEPTH = 4;
/** Default children per expansion. */
export const DEFAULT_BRANCHING_FACTOR = 3;
/** UCB1 exploration constant. √2 is the textbook setting. */
export const DEFAULT_UCB_CONSTANT = Math.SQRT2;
/** Backprop discount factor γ — favours nearer ancestors over distant ones. */
export const DEFAULT_DISCOUNT = 0.9;
/** All children below this average → emit a reflection on the parent. */
export const DEFAULT_REFLECTION_THRESHOLD = 0.3;
/** Stop early when any leaf's avg score reaches this. */
export const DEFAULT_EARLY_EXIT_SCORE = 0.95;
/** Token budget — same cap as ToT so cost comparisons are honest. */
export const DEFAULT_BUDGET_TOKENS = 25_000;
/** Hard cap on expander calls — same as ToT (HARD_MAX_EXPANSIONS). */
export const HARD_MAX_EXPANSIONS = 50;
/** Rough per-expansion token estimate (same as ToT). */
export const ESTIMATED_TOKENS_PER_EXPANSION = 500;
