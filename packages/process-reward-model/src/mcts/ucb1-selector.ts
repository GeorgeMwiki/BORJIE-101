/**
 * UCB1 selector — picks the child maximising the standard upper-confidence
 * bound. See §3.2 of the spec.
 *
 *   UCB1(child) = Q(child) + c · √(ln(N(parent)) / N(child))
 *
 * Unvisited children are treated as infinite-priority — we always
 * expand them before re-visiting. This matches the reference UCB1 +
 * AlphaGo Zero formulation.
 */

import type { MctsNode } from '../types.js';

export function ucb1Score(
  parent: MctsNode,
  child: MctsNode,
  explorationC: number,
): number {
  if (child.visits === 0) return Number.POSITIVE_INFINITY;
  const parentVisits = Math.max(parent.visits, 1);
  const exploitation = child.meanValue;
  const exploration =
    explorationC * Math.sqrt(Math.log(parentVisits) / child.visits);
  return exploitation + exploration;
}

/**
 * Selects the child with the highest UCB1 score. Ties broken
 * deterministically by ascending node id so test runs are repeatable.
 */
export function selectByUcb1(
  parent: MctsNode,
  children: ReadonlyArray<MctsNode>,
  explorationC: number,
): MctsNode | null {
  if (children.length === 0) return null;
  let best: MctsNode | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const child of children) {
    const score = ucb1Score(parent, child, explorationC);
    if (
      score > bestScore ||
      (score === bestScore && best !== null && child.id < best.id)
    ) {
      best = child;
      bestScore = score;
    }
  }
  return best;
}
