/**
 * LATS — Language Agent Tree Search planner.
 *
 * Alternative to the beam-search ToT in `search-planner.ts`. Builds the
 * full MCTS tree (no beam pruning), uses UCB1 to balance exploration
 * with exploitation, backpropagates leaf rewards up the parent chain
 * with a discount γ, and emits self-reflections on sub-trees whose
 * children all underperform a threshold.
 *
 * Algorithm (one iteration):
 *
 *   1. SELECT — descend from root using UCB1. At each node, pick the
 *      child with the highest `value/visits + c·√(ln(parentVisits)/visits)`.
 *      Unvisited children (visits=0) get +∞ so they always get a turn
 *      before exploitation kicks in. Stop at the first node that has
 *      no children yet OR fewer children than `branchingFactor`.
 *
 *   2. EXPAND — ask the injected `expander` for up to K next thoughts.
 *      Attach them as children. Token budget + HARD_MAX_EXPANSIONS
 *      guard the call (same caps as ToT planner).
 *
 *   3. EVALUATE — score the FIRST new child via the injected
 *      `evaluator`. Catch throws → mark the child failed and continue
 *      (the search is robust to adversarial evaluators).
 *
 *   4. BACKPROP — walk parent chain from the evaluated node back to
 *      root. At step `k`, add `γ^k · reward` to that ancestor's value
 *      and bump visits by 1. The discount makes nearer ancestors feel
 *      the reward more strongly than distant ones — without γ, the
 *      root's running average becomes dominated by far-leaf noise.
 *
 *   5. REFLECT — if EVERY child of the just-expanded parent has avg
 *      value < `reflectionThreshold`, emit a `LatsReflection`. The
 *      caller (planner-loop) can route this to the reflexion-lessons
 *      buffer so the next planning pass avoids the same failed
 *      sub-tree. Same parent never gets a duplicate reflection
 *      within one search.
 *
 *   6. EXIT — early if any node's avg value ≥ `earlyExitScore`.
 *      Otherwise loop until `maxIterations`, token budget, or
 *      HARD_MAX_EXPANSIONS is hit.
 *
 * Determinism: given a deterministic evaluator, expander, idGenerator,
 * and random, the search returns an identical tree on every call.
 * Children with identical UCB1 scores break ties using `random()`.
 *
 * Coexistence with ToT: same `Thought` / `PlanContext` contract → the
 * two planners are drop-in alternatives in the kernel-deliberation
 * layer (see `kernel-deliberation.ts` callers).
 */

import type {
  Evaluator,
  Expander,
  PlanContext,
  Thought,
} from './search-planner.js';
import {
  DEFAULT_BRANCHING_FACTOR,
  DEFAULT_BUDGET_TOKENS,
  DEFAULT_DISCOUNT,
  DEFAULT_EARLY_EXIT_SCORE,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_REFLECTION_THRESHOLD,
  DEFAULT_UCB_CONSTANT,
  ESTIMATED_TOKENS_PER_EXPANSION,
  HARD_MAX_EXPANSIONS,
  type LatsEvaluator,
  type LatsExpander,
  type LatsNode,
  type LatsOptions,
  type LatsReflection,
  type LatsResult,
} from './lats-types.js';

// Re-export the type contract so callers get a single import surface.
export type {
  LatsEvaluator,
  LatsExpander,
  LatsNode,
  LatsOptions,
  LatsReflection,
  LatsResult,
} from './lats-types.js';
export {
  DEFAULT_BRANCHING_FACTOR,
  DEFAULT_BUDGET_TOKENS,
  DEFAULT_DISCOUNT,
  DEFAULT_EARLY_EXIT_SCORE,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_REFLECTION_THRESHOLD,
  DEFAULT_UCB_CONSTANT,
  ESTIMATED_TOKENS_PER_EXPANSION,
  HARD_MAX_EXPANSIONS,
} from './lats-types.js';

// ─────────────────────────────────────────────────────────────────────
// Public entry
// ─────────────────────────────────────────────────────────────────────

/**
 * Run a LATS search rooted at `goal`. See module comment for the
 * algorithm. Pure w.r.t. inputs aside from the injected oracles +
 * idGenerator + random.
 *
 * Always returns a defined result even on degenerate inputs (empty
 * expansions, throwing evaluators, zero iterations) so callers can
 * always read `result.bestPath[0]` for the root id.
 */
export async function latsSearch(
  goal: string,
  options: LatsOptions,
): Promise<LatsResult> {
  const maxIterations = clampPositive(
    options.maxIterations,
    DEFAULT_MAX_ITERATIONS,
  );
  const maxDepth = clampPositive(options.maxDepth, DEFAULT_MAX_DEPTH);
  const branchingFactor = clampPositive(
    options.branchingFactor,
    DEFAULT_BRANCHING_FACTOR,
  );
  const ucbConstant = clampNonNegative(
    options.ucbConstant,
    DEFAULT_UCB_CONSTANT,
  );
  const discount = clampUnit(options.discount, DEFAULT_DISCOUNT);
  const reflectionThreshold = clampUnit(
    options.reflectionThreshold,
    DEFAULT_REFLECTION_THRESHOLD,
  );
  const earlyExitScore = clampUnit(
    options.earlyExitScore,
    DEFAULT_EARLY_EXIT_SCORE,
  );
  const budgetTokens = clampPositive(
    options.budgetTokens,
    DEFAULT_BUDGET_TOKENS,
  );
  const nextId = options.idGenerator ?? defaultIdGenerator();
  const random = options.random ?? defaultRandom();

  const context: PlanContext = { goal };

  // Build the root. The root has no parent and a "score" of 0 — we
  // never run the evaluator on the goal itself (it's the prompt, not a
  // plan step), so its visits/value start at 0 and only get bumped by
  // backprop from descendant rollouts.
  const rootThought: Thought = freezeThought({
    id: nextId(),
    content: goal,
    depth: 0,
    parentId: null,
    score: 0,
    explored: false,
  });
  const root: LatsNode = freezeNode({
    id: rootThought.id,
    thought: rootThought,
    parentId: null,
    childrenIds: [],
    value: 0,
    visits: 0,
    ucb: 0,
    failed: false,
    reflection: null,
  });

  const nodesById = new Map<string, LatsNode>();
  nodesById.set(root.id, root);

  const reflections: LatsReflection[] = [];
  const reflectedParents = new Set<string>();

  let iterationsUsed = 0;
  let expansionsUsed = 0;
  let pruned = 0;
  let bestNodeId = root.id;
  let bestScore = 0;
  let earlyExitHit = false;

  for (let iter = 0; iter < maxIterations; iter += 1) {
    // Budget + cap guards — break BEFORE expansion so partial results
    // (and the tree built so far) are still useful to the caller.
    if (expansionsUsed >= HARD_MAX_EXPANSIONS) break;
    const projectedTokens =
      (expansionsUsed + 1) * ESTIMATED_TOKENS_PER_EXPANSION;
    if (projectedTokens > budgetTokens) break;

    iterationsUsed += 1;

    // (1) SELECT — descend by UCB1 to a frontier node.
    const leaf = selectByUcb(nodesById, root.id, ucbConstant, random);
    if (!leaf) break;

    // Depth guard — refuse to expand past maxDepth. The node is
    // "frontier" but treated as terminal: backprop its current value
    // up the tree so the parent's stats keep evolving.
    if (leaf.thought.depth >= maxDepth) {
      backpropagate(nodesById, leaf.id, leaf.value, discount);
      continue;
    }

    // (2) EXPAND.
    let rawChildren: ReadonlyArray<Thought>;
    try {
      rawChildren = await callExpander(
        options.expander,
        leaf.thought,
        branchingFactor,
      );
    } catch {
      rawChildren = [];
    }
    expansionsUsed += 1;

    if (rawChildren.length === 0) {
      // Dead branch — mark explored. No expansion happened so we still
      // run a backprop from the leaf (its current value, possibly 0)
      // to keep visit counts honest.
      nodesById.set(
        leaf.id,
        freezeNode({ ...leaf, thought: { ...leaf.thought, explored: true } }),
      );
      backpropagate(nodesById, leaf.id, leaf.value, discount);
      continue;
    }

    // Re-stamp ids + parent pointers so the expander can't poison
    // tree invariants.
    const normalisedChildren = rawChildren
      .slice(0, branchingFactor)
      .map((c) =>
        freezeThought({
          id: nextId(),
          content: c.content,
          depth: leaf.thought.depth + 1,
          parentId: leaf.id,
          score: 0,
          explored: false,
        }),
      );

    // (3) EVALUATE every new child — we need scores on each so the
    // reflection heuristic has data, and so subsequent UCB1 selections
    // can compare children meaningfully.
    const newChildNodes: LatsNode[] = [];
    for (const childThought of normalisedChildren) {
      const score = await safeEvaluate(options.evaluator, childThought, context);
      if (score === null) {
        // Evaluator threw — keep the node but mark it failed so UCB1
        // skips it. The caller can still see it in `nodesById`.
        const failedNode = freezeNode({
          id: childThought.id,
          thought: freezeThought({ ...childThought, explored: true }),
          parentId: leaf.id,
          childrenIds: [],
          value: 0,
          visits: 0,
          ucb: 0,
          failed: true,
          reflection: null,
        });
        nodesById.set(failedNode.id, failedNode);
        newChildNodes.push(failedNode);
        pruned += 1;
        continue;
      }

      const scoredThought = freezeThought({ ...childThought, score });
      // Note: visits/value start at 0 — backprop below will count the
      // first visit AND apply γ^0 = 1.0 to the leaf, so the leaf itself
      // gets the full reward, the parent gets γ·R, grandparent γ²·R,
      // and so on up to the root.
      const childNode = freezeNode({
        id: scoredThought.id,
        thought: scoredThought,
        parentId: leaf.id,
        childrenIds: [],
        value: 0,
        visits: 0,
        ucb: 0,
        failed: false,
        reflection: null,
      });
      nodesById.set(childNode.id, childNode);
      newChildNodes.push(childNode);

      if (score > bestScore) {
        bestScore = score;
        bestNodeId = childNode.id;
      }
    }

    // Attach children to the parent.
    const updatedLeaf = freezeNode({
      ...leaf,
      thought: freezeThought({ ...leaf.thought, explored: true }),
      childrenIds: [
        ...leaf.childrenIds,
        ...newChildNodes.map((n) => n.id),
      ],
    });
    nodesById.set(updatedLeaf.id, updatedLeaf);

    // (4) BACKPROP — walk up the chain starting at each scored child.
    // The child itself gets its raw score (γ^0 = 1.0); its parent gets
    // γ·score; grandparent γ²·score; etc. Per-child so the parent
    // accumulates evidence from every sibling, not just the first one.
    for (const child of newChildNodes) {
      if (child.failed) continue;
      backpropagate(nodesById, child.id, child.thought.score, discount);
    }

    // (5) REFLECT — if all scored children sit below the threshold,
    // emit a one-shot reflection on the parent. Re-fetch from the map
    // because backprop above mutated visit counts + values; the local
    // `newChildNodes` references are stale snapshots.
    const refreshedScoredChildren = newChildNodes
      .filter((c) => !c.failed)
      .map((c) => nodesById.get(c.id))
      .filter((c): c is LatsNode => c !== undefined);
    const meanScore = (n: LatsNode): number =>
      n.visits > 0 ? n.value / n.visits : n.thought.score;
    const scoredChildren = refreshedScoredChildren;
    if (
      scoredChildren.length > 0 &&
      !reflectedParents.has(leaf.id) &&
      scoredChildren.every((c) => meanScore(c) < reflectionThreshold)
    ) {
      reflectedParents.add(leaf.id);
      const failedIds = scoredChildren.map((c) => c.id);
      const reflection: LatsReflection = Object.freeze({
        parentId: leaf.id,
        parentContent: leaf.thought.content,
        failedChildIds: Object.freeze(failedIds),
        lesson: buildReflectionLesson(
          leaf.thought.content,
          scoredChildren,
          reflectionThreshold,
        ),
        threshold: reflectionThreshold,
      });
      reflections.push(reflection);
      const reflectedLeaf = freezeNode({
        ...updatedLeaf,
        reflection: reflection.lesson,
      });
      nodesById.set(reflectedLeaf.id, reflectedLeaf);
    }

    // (6) EXIT — best-so-far already at goal.
    if (bestScore >= earlyExitScore) {
      earlyExitHit = true;
      break;
    }
  }

  // earlyExitHit is currently informational — the loop already breaks
  // when it fires. Reserved for future telemetry hookups.
  void earlyExitHit;

  // Compute the best path. Prefer the highest-avg-value leaf in the
  // tree; fall back to the highest raw score we recorded during
  // evaluation (handles the case where backprop hasn't run yet).
  const bestPathId = pickBestLeaf(nodesById, root.id) ?? bestNodeId;
  const bestPath = tracePath(nodesById, bestPathId);
  const bestNode = nodesById.get(bestPathId);
  const finalBestScore = bestNode
    ? bestNode.visits > 0
      ? bestNode.value / bestNode.visits
      : bestNode.thought.score
    : bestScore;

  // Refresh root reference — backprop may have mutated visit/value.
  const finalRoot = nodesById.get(root.id) ?? root;

  const tokensUsed = expansionsUsed * ESTIMATED_TOKENS_PER_EXPANSION;

  return Object.freeze({
    bestPath,
    bestScore: clampUnit(finalBestScore, 0),
    tree: finalRoot,
    nodesById,
    reflections: Object.freeze(reflections),
    iterationsUsed,
    expansionsUsed,
    tokensUsed,
    pruned,
  });
}

// ─────────────────────────────────────────────────────────────────────
// UCB1 selection
// ─────────────────────────────────────────────────────────────────────

/**
 * UCB1 score = exploit + explore.
 *   exploit = value / visits           (the running average reward)
 *   explore = c · √(ln(parentVisits) / visits)
 *
 * Unvisited children (visits = 0) return +∞ so the search exhausts new
 * options before revisiting old ones — this is the standard UCB1
 * convention and matches the LITFIN port.
 *
 * Exported for direct unit testing — the formula is the heart of LATS
 * and we want a tight isolated test that the math matches the paper.
 */
export function ucb1Score(
  node: LatsNode,
  parentVisits: number,
  c: number,
): number {
  if (node.failed) return Number.NEGATIVE_INFINITY;
  if (node.visits === 0) return Number.POSITIVE_INFINITY;
  const exploit = node.value / node.visits;
  const safeParent = Math.max(parentVisits, 1);
  const explore = c * Math.sqrt(Math.log(safeParent) / node.visits);
  return exploit + explore;
}

/**
 * Walk down the tree from `rootId`, at each step picking the child
 * with the highest UCB1 score. Stops at the first node that has fewer
 * children than `branchingFactor` OR is a leaf — that's the frontier
 * we expand next.
 *
 * Tie-break: when two children have UCB scores within EPSILON, we
 * sample using `random()` so deterministic seeds → deterministic trees.
 */
function selectByUcb(
  nodes: ReadonlyMap<string, LatsNode>,
  rootId: string,
  c: number,
  random: () => number,
): LatsNode | undefined {
  let current = nodes.get(rootId);
  if (!current) return undefined;

  // Walk until we hit a node whose children are all explored AND have
  // visits > 0 OR a leaf. The frontier we return is always the
  // expansion candidate.
  const guard = nodes.size + 1;
  let steps = 0;
  while (steps < guard) {
    steps += 1;
    if (current.childrenIds.length === 0) return current;

    const children = current.childrenIds
      .map((cid) => nodes.get(cid))
      .filter((n): n is LatsNode => n !== undefined && !n.failed);

    if (children.length === 0) return current;

    const best = pickByUcb(children, current.visits, c, random);
    if (!best) return current;

    // Frontier rule: if `best` itself has no children yet, return it
    // for expansion. Otherwise keep descending.
    if (best.childrenIds.length === 0) return best;
    current = best;
  }
  return current;
}

/**
 * Pick the child with the highest UCB1 score. Pure function — exposed
 * for tests so we can verify selection without running the full loop.
 */
export function pickByUcb(
  children: ReadonlyArray<LatsNode>,
  parentVisits: number,
  c: number,
  random: () => number = defaultRandom(),
): LatsNode | undefined {
  if (children.length === 0) return undefined;
  const EPSILON = 1e-9;
  let best: LatsNode | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const child of children) {
    const score = ucb1Score(child, parentVisits, c);
    if (score > bestScore + EPSILON) {
      bestScore = score;
      best = child;
    } else if (Math.abs(score - bestScore) <= EPSILON && best) {
      // Tie-break with random — keeps determinism when seeded.
      if (random() < 0.5) best = child;
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────
// Backpropagation
// ─────────────────────────────────────────────────────────────────────

/**
 * Walk from `startId` up to the root, adding γ^k · reward to each
 * ancestor's value (k = hops from the start) and bumping visits.
 *
 * Why discount? Without γ a near-root path that branches into a
 * mediocre leaf gets the same value bump as the leaf itself, drowning
 * the root's avg in distant noise. γ=0.9 means depth-1 ancestors feel
 * 90% of the reward, depth-2 feel 81%, etc. — close ancestors react
 * faster to leaf news, far ancestors react slowly.
 *
 * Exported for unit tests.
 */
export function backpropagate(
  nodes: Map<string, LatsNode>,
  startId: string,
  reward: number,
  discount: number,
): void {
  let cursor: string | null = startId;
  let depth = 0;
  const guard = nodes.size + 1;
  while (cursor !== null && depth < guard) {
    const node = nodes.get(cursor);
    if (!node) break;
    const decayed = reward * Math.pow(discount, depth);
    nodes.set(
      cursor,
      freezeNode({
        ...node,
        value: node.value + decayed,
        visits: node.visits + 1,
      }),
    );
    cursor = node.parentId;
    depth += 1;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Reflection
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a one-paragraph reflection on why the children of `parent`
 * underperformed. Deterministic — pure function of inputs.
 */
function buildReflectionLesson(
  parentContent: string,
  failedChildren: ReadonlyArray<LatsNode>,
  threshold: number,
): string {
  const trimmedParent =
    parentContent.length > 80
      ? `${parentContent.slice(0, 77)}...`
      : parentContent;
  const samples = failedChildren
    .slice(0, 3)
    .map((c) => {
      const avg = c.visits > 0 ? c.value / c.visits : c.thought.score;
      const trimmed =
        c.thought.content.length > 60
          ? `${c.thought.content.slice(0, 57)}...`
          : c.thought.content;
      return `"${trimmed}" (${avg.toFixed(2)})`;
    })
    .join(', ');
  return [
    `Branch failed: from parent "${trimmedParent}", all ${failedChildren.length}`,
    `expansion candidates scored below ${threshold.toFixed(2)}.`,
    `Samples: ${samples}.`,
    `Avoid this sub-strategy on the next planning iteration.`,
  ].join(' ');
}

// ─────────────────────────────────────────────────────────────────────
// Best-path extraction
// ─────────────────────────────────────────────────────────────────────

/**
 * Walk from root, at each step following the child with the highest
 * average value (`value/visits`). Stops at a leaf or when no child has
 * been visited. Returns the leaf id, or undefined if the tree is just
 * the root.
 */
function pickBestLeaf(
  nodes: ReadonlyMap<string, LatsNode>,
  rootId: string,
): string | undefined {
  let current = nodes.get(rootId);
  if (!current) return undefined;
  if (current.childrenIds.length === 0) return current.id;

  const guard = nodes.size + 1;
  let steps = 0;
  let best: LatsNode = current;
  while (steps < guard) {
    steps += 1;
    if (current.childrenIds.length === 0) return current.id;

    let bestChild: LatsNode | undefined;
    let bestAvg = Number.NEGATIVE_INFINITY;
    for (const cid of current.childrenIds) {
      const child = nodes.get(cid);
      if (!child || child.failed) continue;
      const avg = child.visits > 0 ? child.value / child.visits : child.thought.score;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestChild = child;
      }
    }
    if (!bestChild) return current.id;
    best = bestChild;
    current = bestChild;
  }
  return best.id;
}

/**
 * Walk back from `leafId` to the root, returning ids in root-first
 * order. Defensive — bails on broken parent chains rather than
 * throwing.
 */
function tracePath(
  nodes: ReadonlyMap<string, LatsNode>,
  leafId: string,
): ReadonlyArray<string> {
  const path: string[] = [];
  let cursor: string | null = leafId;
  const guard = nodes.size + 1;
  let steps = 0;
  while (cursor !== null && steps < guard) {
    path.push(cursor);
    const node = nodes.get(cursor);
    if (!node) break;
    cursor = node.parentId;
    steps += 1;
  }
  return Object.freeze(path.reverse());
}

// ─────────────────────────────────────────────────────────────────────
// Evaluator wrapper — same defensive shape as ToT.
// ─────────────────────────────────────────────────────────────────────

async function safeEvaluate(
  evaluator: LatsEvaluator | Evaluator,
  thought: Thought,
  context: PlanContext,
): Promise<number | null> {
  try {
    const raw = await evaluator(thought, context);
    return clampUnit(raw, 0);
  } catch {
    return null;
  }
}

async function callExpander(
  expander: LatsExpander | Expander,
  parent: Thought,
  k: number,
): Promise<ReadonlyArray<Thought>> {
  const out = await expander(parent, k);
  return Array.isArray(out) ? out : [];
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

function defaultIdGenerator(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `lats_${n}`;
  };
}

/**
 * Deterministic PRNG seeded with 0. Returns a function in [0, 1). The
 * mulberry32 variant — small, fast, and well-distributed enough for
 * tie-breaking.
 */
function defaultRandom(): () => number {
  let state = 0x9e3779b9 >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampPositive(v: number | undefined, fallback: number): number {
  if (v === undefined || !Number.isFinite(v) || v <= 0) return fallback;
  return Math.floor(v);
}

function clampNonNegative(v: number | undefined, fallback: number): number {
  if (v === undefined || !Number.isFinite(v) || v < 0) return fallback;
  return v;
}

function clampUnit(v: number | undefined, fallback: number): number {
  if (v === undefined || !Number.isFinite(v)) return fallback;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function freezeThought(t: Thought): Thought {
  return Object.freeze({ ...t });
}

function freezeNode(n: LatsNode): LatsNode {
  return Object.freeze({
    ...n,
    childrenIds: Object.freeze([...n.childrenIds]),
  });
}
