import { describe, expect, it } from 'vitest';

import {
  createChildNode,
  createRootNode,
  resetNodeCounterForTests,
  withBackpropagatedValue,
} from '../mcts/tree-node.js';
import { selectByUcb1, ucb1Score } from '../mcts/ucb1-selector.js';
import type { MctsNode, ReasoningState, ReasoningStep } from '../types.js';

function makeState(): ReasoningState {
  return Object.freeze({
    intentKind: 'unit-test',
    steps: Object.freeze([]),
    observations: Object.freeze([]),
    depth: 0,
    terminal: false,
  });
}

function makeStep(id: string): ReasoningStep {
  return Object.freeze({
    id,
    kind: 'tool_call' as const,
    toolName: 'noop',
    args: Object.freeze({}),
    rationale: 'unit',
  });
}

describe('ucb1Score', () => {
  it('returns infinity for unvisited children', () => {
    resetNodeCounterForTests();
    const root = createRootNode(makeState());
    const child = createChildNode({
      parent: root,
      state: makeState(),
      incomingStep: makeStep('s1'),
      priorScore: 0.5,
    });
    expect(ucb1Score(root, child, Math.SQRT2)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('balances exploitation and exploration', () => {
    resetNodeCounterForTests();
    let root = createRootNode(makeState());
    root = withBackpropagatedValue(root, 0.5);
    root = withBackpropagatedValue(root, 0.5);
    root = withBackpropagatedValue(root, 0.5);
    const child = withBackpropagatedValue(
      createChildNode({
        parent: root,
        state: makeState(),
        incomingStep: makeStep('s1'),
        priorScore: 0.5,
      }),
      0.7,
    );
    const score = ucb1Score(root, child, Math.SQRT2);
    expect(score).toBeGreaterThan(0.7);
    expect(Number.isFinite(score)).toBe(true);
  });
});

describe('selectByUcb1', () => {
  it('returns null on empty child list', () => {
    resetNodeCounterForTests();
    const root = createRootNode(makeState());
    expect(selectByUcb1(root, [], Math.SQRT2)).toBeNull();
  });

  it('prefers unvisited children over visited ones', () => {
    resetNodeCounterForTests();
    const root = withBackpropagatedValue(
      createRootNode(makeState()),
      0.5,
    );
    const visited = withBackpropagatedValue(
      createChildNode({
        parent: root,
        state: makeState(),
        incomingStep: makeStep('s1'),
        priorScore: 0.9,
      }),
      0.9,
    );
    const fresh = createChildNode({
      parent: root,
      state: makeState(),
      incomingStep: makeStep('s2'),
      priorScore: 0.1,
    });
    const picked = selectByUcb1(root, [visited, fresh], Math.SQRT2);
    expect(picked?.id).toBe(fresh.id);
  });

  it('among visited children, picks the highest mean value', () => {
    resetNodeCounterForTests();
    let root = createRootNode(makeState());
    root = withBackpropagatedValue(root, 0.5);
    root = withBackpropagatedValue(root, 0.5);

    const low = withBackpropagatedValue(
      createChildNode({
        parent: root,
        state: makeState(),
        incomingStep: makeStep('s1'),
        priorScore: 0.5,
      }),
      0.3,
    );
    const high = withBackpropagatedValue(
      createChildNode({
        parent: root,
        state: makeState(),
        incomingStep: makeStep('s2'),
        priorScore: 0.5,
      }),
      0.95,
    );
    const picked: MctsNode | null = selectByUcb1(root, [low, high], 0.01);
    expect(picked?.id).toBe(high.id);
  });
});
