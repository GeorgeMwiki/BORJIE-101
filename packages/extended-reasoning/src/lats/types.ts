/**
 * Language Agent Tree Search (LATS) — Zhou ICML 2024 (arXiv:2310.04406).
 *
 * MCTS over **action trajectories** (not tokens) with UCB1 selection and
 * a reflection-based value-network shortcut. The L1 audit deferred this as
 * "overkill for MD" — true for single-turn decisions, but BORJIE has
 * very real long-horizon flows where the action space is large and feedback
 * is sparse:
 *
 *   - 60-day lease renewal (send-early / wait / discount / partial / not)
 *   - 30-day onboarding (KYC → contract → deposit → keys → first inspection)
 *   - 90-day eviction (notice → cure period → court filing → hearing → enforcement)
 *   - monthly KRA cycle (compute → file → settle → reconcile)
 *
 * Each "action" advances the state by one symbolic step. The reflection
 * callback consults K-D's Reflexion store (lessons from prior renewals)
 * to prune branches that have failed before in similar conditions.
 */

import type { JsonValue } from '../shared/types.js';

/** Opaque state token — anything JSON-safe. */
export type LatsState = JsonValue;

/** Opaque action — must be JSON-safe so we can log trajectories. */
export type LatsAction = JsonValue & { readonly kind: string };

export interface ReflectionRecord {
  readonly stateSig: string;
  readonly action: LatsAction;
  readonly outcome: 'good' | 'bad' | 'neutral';
  readonly note: string;
}

/**
 * Caller-supplied action enumerator. Returns the list of legal actions from
 * a given state. Empty list means terminal.
 */
export type ActionSpaceFn = (state: LatsState, depth: number) => ReadonlyArray<LatsAction>;

/**
 * Caller-supplied transition. Pure: given state + action, return next state.
 * MCTS uses this in simulations — deterministic transitions are recommended
 * for testability; if the real environment is stochastic, the caller can
 * sample inside this function.
 */
export type TransitionFn = (
  state: LatsState,
  action: LatsAction,
  depth: number,
) => LatsState;

/**
 * Reward in [0, 1]. Sparse rewards are fine — MCTS handles them, but
 * we recommend dense shaping where possible.
 */
export type RewardFn = (state: LatsState, depth: number) => number;

/**
 * Returns `true` when the node should be pruned. Consulted before expansion.
 * Typical implementation: hash the (stateSig, action) into K-D's Reflexion
 * store and prune if past outcome was `bad` with high confidence.
 */
export type ReflectionFn = (
  state: LatsState,
  candidateAction: LatsAction,
  reflections: ReadonlyArray<ReflectionRecord>,
) => boolean;

export interface RunLatsInput {
  readonly rootState: LatsState;
  readonly actionSpace: ActionSpaceFn;
  readonly transition: TransitionFn;
  readonly rewardFn: RewardFn;
  readonly maxSimulations: number;
  readonly maxDepth: number;
  /** Exploration constant for UCB1. Default sqrt(2). */
  readonly explorationC?: number;
  /** Deterministic seed for replay. Default 0xBOSS_NYUMBA. */
  readonly seed?: number;
  /**
   * Reflection prefix. The runner calls `reflectionCallback` before expanding
   * a child; if it returns `true`, the child is skipped. Prior reflections
   * are passed in — typically loaded from K-D's Reflexion memory tier.
   */
  readonly reflectionCallback?: ReflectionFn;
  readonly reflections?: ReadonlyArray<ReflectionRecord>;
}

export interface LatsTrajectoryStep {
  readonly state: LatsState;
  readonly action: LatsAction;
  readonly reward: number;
}

export interface RunLatsResult {
  /**
   * The empirically best action sequence found within the simulation budget.
   * The runner walks down the tree picking max-visit child at each step.
   */
  readonly bestTrajectory: ReadonlyArray<LatsTrajectoryStep>;
  readonly bestTotalReward: number;
  readonly simulationsRun: number;
  /** Branches pruned by the reflection callback. */
  readonly prunedBranches: number;
}
