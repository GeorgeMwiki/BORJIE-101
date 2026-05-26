/**
 * Tree-node helpers. Pure constructors + immutable updates — every
 * change produces a new node.
 */

import type { MctsNode, ReasoningState, ReasoningStep } from '../types.js';

let nodeCounter = 0;

/**
 * Reset the internal counter — only safe in tests where we want stable
 * node ids. Not exported from the package surface.
 */
export function resetNodeCounterForTests(): void {
  nodeCounter = 0;
}

function nextNodeId(): string {
  nodeCounter += 1;
  return `n-${String(nodeCounter)}`;
}

export function createRootNode(state: ReasoningState): MctsNode {
  return Object.freeze({
    id: nextNodeId(),
    state,
    parentId: null,
    incomingStep: null,
    priorScore: 0.5,
    visits: 0,
    meanValue: 0,
    children: Object.freeze([]),
  });
}

export function createChildNode(input: {
  readonly parent: MctsNode;
  readonly state: ReasoningState;
  readonly incomingStep: ReasoningStep;
  readonly priorScore: number;
}): MctsNode {
  return Object.freeze({
    id: nextNodeId(),
    state: input.state,
    parentId: input.parent.id,
    incomingStep: input.incomingStep,
    priorScore: input.priorScore,
    visits: 0,
    meanValue: input.priorScore,
    children: Object.freeze([]),
  });
}

export function withAddedChild(parent: MctsNode, childId: string): MctsNode {
  return Object.freeze({
    ...parent,
    children: Object.freeze([...parent.children, childId]),
  });
}

export function withBackpropagatedValue(
  node: MctsNode,
  rolloutValue: number,
): MctsNode {
  const nextVisits = node.visits + 1;
  const nextMean = node.meanValue + (rolloutValue - node.meanValue) / nextVisits;
  return Object.freeze({
    ...node,
    visits: nextVisits,
    meanValue: nextMean,
  });
}
