/**
 * Stakes-aware planner dispatcher — Wave-13 F9 wiring.
 *
 * The orchestrator owns two search-based planners (Wave-12):
 *
 *   - `searchPlan(...)`  → beam-search Tree-of-Thoughts (cheap, fast)
 *   - `latsSearch(...)`  → full MCTS + UCB1 + value backprop (more
 *                          iterations, more thorough, more expensive)
 *
 * Until this dispatcher landed, callers had to hard-pick one planner.
 * The cost-aware switch routes the request to the right planner based
 * on `stakes`:
 *
 *   - low / medium → ToT (cheaper; bounded by depth + beam width)
 *   - high / critical → LATS (more iterations; value-backpropagated
 *                       average lets the search exploit good sub-trees)
 *
 * The dispatcher returns a unified `DispatchedPlanResult` so callers
 * don't branch on which planner ran. Both planners share the
 * `Evaluator` / `Expander` contracts, so the dispatcher just forwards
 * them.
 *
 * Optional `parallel: true` mode: run BOTH planners in parallel and
 * pick the higher-scoring `bestPath`. Off by default — the synchronous
 * stakes-switch is the production code path. Parallel mode is exposed
 * for evals that compare planner quality directly.
 *
 * @module kernel/orchestrator/planner-dispatcher
 */

import {
  searchPlan,
  type Evaluator,
  type Expander,
  type PlanCandidate,
} from './search-planner.js';
import {
  latsSearch,
  type LatsResult,
} from './lats-search.js';

export type DispatchedPlannerKind = 'tot' | 'lats';

/** Unified result shape — both planner backends collapse onto this. */
export interface DispatchedPlanResult {
  /** Which planner produced the result. */
  readonly planner: DispatchedPlannerKind;
  /** Root → best-leaf path of thought IDs. */
  readonly bestPath: ReadonlyArray<string>;
  /** Score of the best path, ∈ [0, 1]. */
  readonly bestScore: number;
  /**
   * Raw planner output. Discriminated by `planner` so a caller that
   * needs the LATS reflections or the ToT pruned count can narrow on
   * the kind without changing the dispatcher's contract.
   */
  readonly raw:
    | { readonly kind: 'tot'; readonly plan: PlanCandidate }
    | { readonly kind: 'lats'; readonly plan: LatsResult };
}

export type PlannerStakes = 'low' | 'medium' | 'high' | 'critical';

export interface DispatchPlannerOptions {
  readonly stakes: PlannerStakes;
  readonly evaluator: Evaluator;
  readonly expander: Expander;
  /**
   * Force a specific planner regardless of stakes. Useful in tests and
   * for canary rollouts. When unset (default), `stakes` decides.
   */
  readonly forcePlanner?: DispatchedPlannerKind;
  /**
   * Run BOTH planners in parallel and return the higher-scoring one.
   * Off by default — parallel mode roughly doubles cost and is only
   * useful for evals. When `true`, `forcePlanner` is ignored.
   */
  readonly parallel?: boolean;
  /** Per-planner option pass-through. */
  readonly tot?: {
    readonly branchingFactor?: number;
    readonly maxDepth?: number;
    readonly beamWidth?: number;
    readonly budgetTokens?: number;
    readonly earlyExitScore?: number;
    readonly divergenceThreshold?: number;
    readonly idGenerator?: () => string;
  };
  readonly lats?: {
    readonly maxIterations?: number;
    readonly maxDepth?: number;
    readonly branchingFactor?: number;
    readonly ucbConstant?: number;
    readonly discount?: number;
    readonly reflectionThreshold?: number;
    readonly earlyExitScore?: number;
    readonly budgetTokens?: number;
    readonly idGenerator?: () => string;
    readonly random?: () => number;
  };
}

/**
 * Pick the planner the dispatcher will route to. Pure function exposed
 * so callers can log the routing decision before they invoke.
 */
export function pickPlannerForStakes(
  stakes: PlannerStakes,
  forcePlanner?: DispatchedPlannerKind,
): DispatchedPlannerKind {
  if (forcePlanner) return forcePlanner;
  if (stakes === 'high' || stakes === 'critical') return 'lats';
  return 'tot';
}

/**
 * Run the stakes-appropriate planner against `goal`. See module comment
 * for the routing rules.
 */
export async function dispatchPlanner(
  goal: string,
  options: DispatchPlannerOptions,
): Promise<DispatchedPlanResult> {
  if (options.parallel === true) {
    return runParallel(goal, options);
  }
  const planner = pickPlannerForStakes(options.stakes, options.forcePlanner);
  if (planner === 'lats') {
    return runLats(goal, options);
  }
  return runTot(goal, options);
}

async function runTot(
  goal: string,
  options: DispatchPlannerOptions,
): Promise<DispatchedPlanResult> {
  const plan = await searchPlan(goal, {
    evaluator: options.evaluator,
    expander: options.expander,
    ...(options.tot?.branchingFactor !== undefined && {
      branchingFactor: options.tot.branchingFactor,
    }),
    ...(options.tot?.maxDepth !== undefined && {
      maxDepth: options.tot.maxDepth,
    }),
    ...(options.tot?.beamWidth !== undefined && {
      beamWidth: options.tot.beamWidth,
    }),
    ...(options.tot?.budgetTokens !== undefined && {
      budgetTokens: options.tot.budgetTokens,
    }),
    ...(options.tot?.earlyExitScore !== undefined && {
      earlyExitScore: options.tot.earlyExitScore,
    }),
    ...(options.tot?.divergenceThreshold !== undefined && {
      divergenceThreshold: options.tot.divergenceThreshold,
    }),
    ...(options.tot?.idGenerator !== undefined && {
      idGenerator: options.tot.idGenerator,
    }),
  });
  return Object.freeze({
    planner: 'tot',
    bestPath: plan.bestPath,
    bestScore: plan.bestScore,
    raw: { kind: 'tot' as const, plan },
  });
}

async function runLats(
  goal: string,
  options: DispatchPlannerOptions,
): Promise<DispatchedPlanResult> {
  const plan = await latsSearch(goal, {
    evaluator: options.evaluator,
    expander: options.expander,
    ...(options.lats?.maxIterations !== undefined && {
      maxIterations: options.lats.maxIterations,
    }),
    ...(options.lats?.maxDepth !== undefined && {
      maxDepth: options.lats.maxDepth,
    }),
    ...(options.lats?.branchingFactor !== undefined && {
      branchingFactor: options.lats.branchingFactor,
    }),
    ...(options.lats?.ucbConstant !== undefined && {
      ucbConstant: options.lats.ucbConstant,
    }),
    ...(options.lats?.discount !== undefined && {
      discount: options.lats.discount,
    }),
    ...(options.lats?.reflectionThreshold !== undefined && {
      reflectionThreshold: options.lats.reflectionThreshold,
    }),
    ...(options.lats?.earlyExitScore !== undefined && {
      earlyExitScore: options.lats.earlyExitScore,
    }),
    ...(options.lats?.budgetTokens !== undefined && {
      budgetTokens: options.lats.budgetTokens,
    }),
    ...(options.lats?.idGenerator !== undefined && {
      idGenerator: options.lats.idGenerator,
    }),
    ...(options.lats?.random !== undefined && {
      random: options.lats.random,
    }),
  });
  return Object.freeze({
    planner: 'lats',
    bestPath: plan.bestPath,
    bestScore: plan.bestScore,
    raw: { kind: 'lats' as const, plan },
  });
}

async function runParallel(
  goal: string,
  options: DispatchPlannerOptions,
): Promise<DispatchedPlanResult> {
  const [tot, lats] = await Promise.all([
    runTot(goal, options),
    runLats(goal, options),
  ]);
  // Defensive — tie goes to LATS since it's the more thorough planner.
  return lats.bestScore >= tot.bestScore ? lats : tot;
}
