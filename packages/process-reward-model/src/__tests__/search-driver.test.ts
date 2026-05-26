/**
 * Smoke test for the MCTS search driver. Asserts:
 *   1. searchDriver terminates within the budget
 *   2. selected path is non-empty when expansion produces children
 *   3. no-expansion is handled gracefully (closed search space)
 *   4. wall-clock termination fires when the clock is sped up
 */

import { describe, expect, it } from 'vitest';

import { resetNodeCounterForTests } from '../mcts/tree-node.js';
import { searchDriver } from '../mcts/search-driver.js';
import { heuristicPrm } from '../prm/heuristic-prm.js';
import {
  DEFAULT_MCTS_BUDGET,
  type ExpansionFn,
  type Observation,
  type PrmContext,
  type ReasoningState,
  type ReasoningStep,
  type SimulationStepFn,
} from '../types.js';

const ctx: PrmContext = Object.freeze({
  tenantId: 'test',
  scopeKind: null,
  scopeId: null,
  autonomyTier: 1,
  killswitchActive: false,
  domainHints: Object.freeze({}),
});

const rootState: ReasoningState = Object.freeze({
  intentKind: 'unit-test',
  steps: Object.freeze([]),
  observations: Object.freeze([]),
  depth: 0,
  terminal: false,
});

function makeExpander(values: ReadonlyArray<number>): ExpansionFn {
  let counter = 0;
  return (parent, width) => {
    if (parent.depth >= 3) return [];
    const out: Array<ReasoningStep> = [];
    for (let i = 0; i < Math.min(width, values.length); i += 1) {
      counter += 1;
      const cites: ReadonlyArray<string> =
        (values[i] ?? 0) >= 0.5 ? ['doc'] : [];
      out.push(
        Object.freeze({
          id: `step-${String(counter)}`,
          kind: 'tool_call' as const,
          toolName: 'noop',
          args: Object.freeze({ citations: cites }),
          rationale: `value=${String(values[i])}`,
        }),
      );
    }
    return out;
  };
}

const stepFn: SimulationStepFn = (state, step) => {
  const obs: Observation = Object.freeze({
    stepId: step.id,
    success: true,
    summary: 'ok',
    schemaValid: true,
  });
  const nextState: ReasoningState = Object.freeze({
    ...state,
    steps: Object.freeze([...state.steps, step]),
    observations: Object.freeze([...state.observations, obs]),
    depth: state.depth + 1,
    terminal: state.depth + 1 >= 3,
  });
  return { nextState, observation: obs };
};

describe('searchDriver', () => {
  it('terminates within the configured budget', () => {
    resetNodeCounterForTests();
    const result = searchDriver({
      rootState,
      prm: heuristicPrm,
      expander: makeExpander([0.7, 0.4, 0.6, 0.3]),
      step: stepFn,
      context: ctx,
      budget: Object.freeze({
        ...DEFAULT_MCTS_BUDGET,
        rollouts: 8,
        maxDepth: 3,
        maxWidth: 3,
      }),
      now: () => 0,
    });
    expect(result.rolloutsRun).toBeLessThanOrEqual(8);
    expect(result.nodes.length).toBeGreaterThan(1);
  });

  it('returns a non-empty selected path when expansion succeeds', () => {
    resetNodeCounterForTests();
    const result = searchDriver({
      rootState,
      prm: heuristicPrm,
      expander: makeExpander([0.9, 0.2]),
      step: stepFn,
      context: ctx,
      budget: Object.freeze({
        ...DEFAULT_MCTS_BUDGET,
        rollouts: 4,
        maxDepth: 2,
        maxWidth: 2,
      }),
      now: () => 0,
    });
    expect(result.selectedPath.length).toBeGreaterThan(0);
  });

  it('handles a closed search space (no children) gracefully', () => {
    resetNodeCounterForTests();
    const emptyExpander: ExpansionFn = () => [];
    const result = searchDriver({
      rootState,
      prm: heuristicPrm,
      expander: emptyExpander,
      step: stepFn,
      context: ctx,
      budget: Object.freeze({
        ...DEFAULT_MCTS_BUDGET,
        rollouts: 4,
        maxDepth: 2,
        maxWidth: 2,
      }),
      now: () => 0,
    });
    expect(result.terminatedReason).toBe('no_expansion_possible');
    expect(result.selectedPath).toHaveLength(0);
  });

  it('fires wall-clock termination when time elapses', () => {
    resetNodeCounterForTests();
    let tick = 0;
    const result = searchDriver({
      rootState,
      prm: heuristicPrm,
      expander: makeExpander([0.7, 0.4]),
      step: stepFn,
      context: ctx,
      budget: Object.freeze({
        ...DEFAULT_MCTS_BUDGET,
        rollouts: 100,
        maxWallMs: 5,
      }),
      now: () => {
        tick += 10;
        return tick;
      },
    });
    expect(result.terminatedReason).toBe('wall_clock_exceeded');
  });
});
