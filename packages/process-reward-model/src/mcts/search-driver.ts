/**
 * MCTS search driver — orchestrates selection → expansion → simulation →
 * backpropagation per the §3 contract. Pure(ish) — accepts pluggable
 * expansion, simulation, and PRM functions so all I/O is at the edges.
 *
 * Termination is the §3.6 disjunction:
 *   1. rollouts ≥ budget
 *   2. confident root choice (visit-share ≥ minVisitShare AND Q ≥ minQValue)
 *   3. wall-clock exceeded
 *   4. no expansion possible (closed search space)
 */

import type {
  ExpansionFn,
  MctsBudget,
  MctsNode,
  MctsSearchResult,
  MctsTerminationReason,
  PrmContext,
  PrmFn,
  ReasoningState,
  ReasoningStep,
  SimulationStepFn,
} from '../types.js';
import { backpropagatePath, type NodeMap } from './backpropagation.js';
import { expandWithScoring } from './expansion-policy.js';
import { rollout } from './simulation.js';
import {
  createChildNode,
  createRootNode,
  withAddedChild,
} from './tree-node.js';
import { selectByUcb1 } from './ucb1-selector.js';

export interface SearchDriverInput {
  readonly rootState: ReasoningState;
  readonly prm: PrmFn;
  readonly expander: ExpansionFn;
  readonly step: SimulationStepFn;
  readonly context: PrmContext;
  readonly budget: MctsBudget;
  readonly now: () => number;
}

interface SearchHandle {
  readonly nodes: NodeMap;
  readonly rolloutsRun: number;
}

function childrenOf(
  nodes: NodeMap,
  node: MctsNode,
): ReadonlyArray<MctsNode> {
  return node.children
    .map((id) => nodes.get(id))
    .filter((n): n is MctsNode => n !== undefined);
}

function selectLeaf(
  nodes: NodeMap,
  rootId: string,
  explorationC: number,
): MctsNode {
  let current = nodes.get(rootId)!;
  while (current.children.length > 0) {
    const kids = childrenOf(nodes, current);
    const next = selectByUcb1(current, kids, explorationC);
    if (!next) break;
    current = next;
  }
  return current;
}

function expandLeaf(input: {
  readonly nodes: NodeMap;
  readonly leaf: MctsNode;
  readonly prm: PrmFn;
  readonly expander: ExpansionFn;
  readonly context: PrmContext;
  readonly width: number;
}): { readonly nodes: NodeMap; readonly newChildren: ReadonlyArray<MctsNode> } {
  const candidates = expandWithScoring({
    parent: input.leaf,
    expander: input.expander,
    prm: input.prm,
    context: input.context,
    width: input.width,
  });
  if (candidates.length === 0) {
    return Object.freeze({ nodes: input.nodes, newChildren: Object.freeze([]) });
  }
  const next = new Map(input.nodes);
  const newChildren: Array<MctsNode> = [];
  let parent = input.leaf;
  for (const cand of candidates) {
    const childState: ReasoningState = Object.freeze({
      ...input.leaf.state,
      steps: Object.freeze([...input.leaf.state.steps, cand.step]),
      depth: input.leaf.state.depth + 1,
      terminal: cand.step.kind === 'commit',
    });
    const child = createChildNode({
      parent,
      state: childState,
      incomingStep: cand.step,
      priorScore: cand.priorScore,
    });
    next.set(child.id, child);
    parent = withAddedChild(parent, child.id);
    next.set(parent.id, parent);
    newChildren.push(child);
  }
  return Object.freeze({ nodes: next, newChildren: Object.freeze(newChildren) });
}

function bestRootChild(
  nodes: NodeMap,
  rootId: string,
): MctsNode | null {
  const root = nodes.get(rootId);
  if (!root) return null;
  const kids = childrenOf(nodes, root);
  if (kids.length === 0) return null;
  let best = kids[0]!;
  for (const k of kids) {
    if (k.meanValue > best.meanValue) best = k;
  }
  return best;
}

function rootVisitShare(
  nodes: NodeMap,
  rootId: string,
  child: MctsNode,
): number {
  const root = nodes.get(rootId);
  if (!root || root.visits === 0) return 0;
  return child.visits / root.visits;
}

function reconstructPath(
  nodes: NodeMap,
  rootId: string,
): ReadonlyArray<ReasoningStep> {
  const out: Array<ReasoningStep> = [];
  let current = bestRootChild(nodes, rootId);
  while (current) {
    if (current.incomingStep) out.push(current.incomingStep);
    const kids = childrenOf(nodes, current);
    if (kids.length === 0) break;
    let next = kids[0]!;
    for (const k of kids) if (k.meanValue > next.meanValue) next = k;
    current = next;
  }
  return Object.freeze(out);
}

function checkConfidentRoot(
  nodes: NodeMap,
  rootId: string,
  budget: MctsBudget,
): boolean {
  const best = bestRootChild(nodes, rootId);
  if (!best) return false;
  const share = rootVisitShare(nodes, rootId, best);
  return share >= budget.minVisitShare && best.meanValue >= budget.minQValue;
}

export function searchDriver(input: SearchDriverInput): MctsSearchResult {
  const start = input.now();
  const root = createRootNode(input.rootState);
  let handle: SearchHandle = Object.freeze({
    nodes: new Map([[root.id, root]]),
    rolloutsRun: 0,
  });

  let terminated: MctsTerminationReason = 'budget_exhausted';

  for (let r = 0; r < input.budget.rollouts; r += 1) {
    if (input.now() - start >= input.budget.maxWallMs) {
      terminated = 'wall_clock_exceeded';
      break;
    }

    const leaf = selectLeaf(handle.nodes, root.id, input.budget.explorationC);

    let nodesAfterExpansion = handle.nodes;
    let target = leaf;
    if (!leaf.state.terminal) {
      const expanded = expandLeaf({
        nodes: handle.nodes,
        leaf,
        prm: input.prm,
        expander: input.expander,
        context: input.context,
        width: input.budget.maxWidth,
      });
      if (expanded.newChildren.length === 0 && leaf.id === root.id) {
        terminated = 'no_expansion_possible';
        handle = Object.freeze({
          nodes: handle.nodes,
          rolloutsRun: handle.rolloutsRun,
        });
        break;
      }
      nodesAfterExpansion = expanded.nodes;
      if (expanded.newChildren.length > 0) {
        target = expanded.newChildren[0]!;
      }
    }

    const outcome = rollout({
      state: target.state,
      prm: input.prm,
      expander: input.expander,
      step: input.step,
      context: input.context,
      maxDepth: input.budget.maxDepth,
      width: input.budget.maxWidth,
    });

    const propagated = backpropagatePath({
      nodes: nodesAfterExpansion,
      leafId: target.id,
      value: outcome.value,
    });

    handle = Object.freeze({
      nodes: propagated,
      rolloutsRun: handle.rolloutsRun + 1,
    });

    if (checkConfidentRoot(propagated, root.id, input.budget)) {
      terminated = 'confident_root_choice';
      break;
    }
  }

  const selectedPath = reconstructPath(handle.nodes, root.id);
  const best = bestRootChild(handle.nodes, root.id);
  const wallMs = input.now() - start;

  return Object.freeze({
    rootId: root.id,
    nodes: Object.freeze(Array.from(handle.nodes.values())),
    selectedPath,
    terminatedReason: terminated,
    rolloutsRun: handle.rolloutsRun,
    wallMs,
    bestValue: best?.meanValue ?? 0,
  });
}
