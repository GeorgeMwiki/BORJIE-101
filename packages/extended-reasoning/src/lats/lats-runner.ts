import type {
  ActionSpaceFn,
  LatsAction,
  LatsState,
  LatsTrajectoryStep,
  ReflectionFn,
  ReflectionRecord,
  RewardFn,
  RunLatsInput,
  RunLatsResult,
  TransitionFn,
} from './types.js';
import { mulberry32 } from './rng.js';

interface MctsNode {
  readonly state: LatsState;
  readonly depth: number;
  readonly action: LatsAction | undefined;
  readonly parent: MctsNode | undefined;
  readonly children: MctsNode[];
  /** Untried actions, pulled from actionSpace on first visit. */
  untried: LatsAction[];
  visits: number;
  totalReward: number;
  reward: number;
  terminal: boolean;
}

function stableStringify(value: LatsState): string {
  // Pure JSON.stringify isn't stable over key order. We sort keys recursively.
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v as LatsState)).join(',') + ']';
  }
  const obj = value as { readonly [k: string]: LatsState };
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k] as LatsState)).join(',') +
    '}'
  );
}

/**
 * UCB1 score. Higher = more attractive to explore/exploit.
 * `nParent` must be > 0 (we only call this on non-root visited nodes).
 */
function ucb1(child: MctsNode, nParent: number, c: number): number {
  if (child.visits === 0) return Number.POSITIVE_INFINITY;
  const exploit = child.totalReward / child.visits;
  const explore = c * Math.sqrt(Math.log(nParent) / child.visits);
  return exploit + explore;
}

function selectChild(node: MctsNode, c: number, rng: () => number): MctsNode {
  let best: MctsNode | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  const tied: MctsNode[] = [];
  for (const child of node.children) {
    const s = ucb1(child, node.visits, c);
    if (s > bestScore) {
      bestScore = s;
      best = child;
      tied.length = 0;
      tied.push(child);
    } else if (s === bestScore) {
      tied.push(child);
    }
  }
  if (tied.length > 1) {
    // Deterministic tie-break via seeded RNG
    const idx = Math.floor(rng() * tied.length);
    const winner = tied[idx];
    if (winner !== undefined) return winner;
  }
  if (best === undefined) {
    throw new Error('[LATS] selectChild called on node with no children');
  }
  return best;
}

function expand(
  node: MctsNode,
  actionSpace: ActionSpaceFn,
  transition: TransitionFn,
  rewardFn: RewardFn,
  maxDepth: number,
  reflections: ReadonlyArray<ReflectionRecord>,
  reflectionCallback: ReflectionFn | undefined,
  prunedCounter: { count: number },
): MctsNode | undefined {
  if (node.untried.length === 0 || node.terminal) return undefined;

  // Filter untried via reflection callback. We do this once per node visit
  // rather than per action so reflections don't dominate the loop cost.
  if (reflectionCallback !== undefined) {
    const survivors: LatsAction[] = [];
    for (const action of node.untried) {
      if (reflectionCallback(node.state, action, reflections)) {
        prunedCounter.count += 1;
      } else {
        survivors.push(action);
      }
    }
    node.untried = survivors;
    if (node.untried.length === 0) {
      node.terminal = true; // nothing left to try here
      return undefined;
    }
  }

  const action = node.untried.shift();
  if (action === undefined) return undefined;

  const nextState = transition(node.state, action, node.depth);
  const reward = rewardFn(nextState, node.depth + 1);
  const nextDepth = node.depth + 1;
  const nextActions = actionSpace(nextState, nextDepth);
  const child: MctsNode = {
    state: nextState,
    depth: nextDepth,
    action,
    parent: node,
    children: [],
    untried: nextActions.slice() as LatsAction[],
    visits: 0,
    totalReward: 0,
    reward,
    terminal: nextDepth >= maxDepth || nextActions.length === 0,
  };
  node.children.push(child);
  return child;
}

function rollout(
  start: MctsNode,
  actionSpace: ActionSpaceFn,
  transition: TransitionFn,
  rewardFn: RewardFn,
  maxDepth: number,
  rng: () => number,
): number {
  let state = start.state;
  let depth = start.depth;
  let total = start.reward;
  while (depth < maxDepth) {
    const actions = actionSpace(state, depth);
    if (actions.length === 0) break;
    const idx = Math.floor(rng() * actions.length);
    const action = actions[idx];
    if (action === undefined) break;
    state = transition(state, action, depth);
    depth += 1;
    total += rewardFn(state, depth);
  }
  return total;
}

function backpropagate(node: MctsNode, totalReward: number): void {
  let curr: MctsNode | undefined = node;
  while (curr !== undefined) {
    curr.visits += 1;
    curr.totalReward += totalReward;
    curr = curr.parent;
  }
}

/**
 * Run LATS over an explicit symbolic environment. Returns the best
 * trajectory by max-visit-count at each level — standard MCTS readout.
 *
 * Determinism: same `seed` + same inputs → identical output.
 */
export async function runLATS(input: RunLatsInput): Promise<RunLatsResult> {
  if (input.maxSimulations <= 0) {
    throw new Error('[LATS] maxSimulations must be > 0');
  }
  if (input.maxDepth <= 0) {
    throw new Error('[LATS] maxDepth must be > 0');
  }
  const c = input.explorationC ?? Math.SQRT2;
  const seed = input.seed ?? 0xb05_5ec0;
  const rng = mulberry32(seed);
  const reflections = input.reflections ?? [];
  const reflectionCallback = input.reflectionCallback;
  const prunedCounter = { count: 0 };

  const rootActions = input.actionSpace(input.rootState, 0);
  const root: MctsNode = {
    state: input.rootState,
    depth: 0,
    action: undefined,
    parent: undefined,
    children: [],
    untried: rootActions.slice() as LatsAction[],
    visits: 0,
    totalReward: 0,
    reward: input.rewardFn(input.rootState, 0),
    terminal: rootActions.length === 0,
  };

  let simulations = 0;
  for (let i = 0; i < input.maxSimulations; i += 1) {
    // === Selection ===
    let node = root;
    while (node.untried.length === 0 && node.children.length > 0 && !node.terminal) {
      node = selectChild(node, c, rng);
    }

    // === Expansion ===
    let leaf = node;
    if (!node.terminal && node.untried.length > 0) {
      const expanded = expand(
        node,
        input.actionSpace,
        input.transition,
        input.rewardFn,
        input.maxDepth,
        reflections,
        reflectionCallback,
        prunedCounter,
      );
      if (expanded !== undefined) leaf = expanded;
    }

    // === Simulation ===
    const total = rollout(
      leaf,
      input.actionSpace,
      input.transition,
      input.rewardFn,
      input.maxDepth,
      rng,
    );

    // === Backprop ===
    backpropagate(leaf, total);
    simulations += 1;
  }

  // === Readout: walk down the tree picking max-visit child ===
  const trajectory: LatsTrajectoryStep[] = [];
  let curr: MctsNode | undefined = root;
  let totalRew = 0;
  while (curr !== undefined && curr.children.length > 0) {
    let bestChild: MctsNode | undefined;
    let bestVisits = -1;
    for (const child of curr.children) {
      // Tie-break on stable string of action so result is deterministic
      if (
        child.visits > bestVisits ||
        (child.visits === bestVisits &&
          bestChild !== undefined &&
          stableStringify(child.action ?? null) < stableStringify(bestChild.action ?? null))
      ) {
        bestVisits = child.visits;
        bestChild = child;
      }
    }
    if (bestChild === undefined || bestChild.action === undefined) break;
    trajectory.push({
      state: bestChild.state,
      action: bestChild.action,
      reward: bestChild.reward,
    });
    totalRew += bestChild.reward;
    curr = bestChild;
  }

  return {
    bestTrajectory: trajectory,
    bestTotalReward: totalRew,
    simulationsRun: simulations,
    prunedBranches: prunedCounter.count,
  };
}

// Re-export the stable-stringify so tests can build identical state sigs
// for reflection records.
export { stableStringify };

// Internal helpers exported for tests
export const __internal = { ucb1, mulberry32 } satisfies {
  ucb1: (c: MctsNode, n: number, k: number) => number;
  mulberry32: (s: number) => () => number;
};

// Mark unused types as referenced (TS won't strip type-only usage of these
// imports but this satisfies noUnusedLocals on platforms where it triggers)
export type _LatsActionUnused = LatsAction;
export type _LatsStateUnused = LatsState;
