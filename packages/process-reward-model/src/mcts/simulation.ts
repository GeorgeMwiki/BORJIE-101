/**
 * Simulation — short rollout from a newly-expanded leaf. See §3.4 of the
 * spec. Greedy-by-heuristic-PRM up to `maxDepth` steps; returns the
 * terminal value (or depth-weighted running mean if the rollout did
 * not hit a terminal within budget).
 */

import type {
  ExpansionFn,
  PrmContext,
  PrmFn,
  ReasoningState,
  SimulationStepFn,
} from '../types.js';

export interface RolloutOutcome {
  readonly value: number;
  readonly depthReached: number;
  readonly hitTerminal: boolean;
}

export function rollout(input: {
  readonly state: ReasoningState;
  readonly prm: PrmFn;
  readonly expander: ExpansionFn;
  readonly step: SimulationStepFn;
  readonly context: PrmContext;
  readonly maxDepth: number;
  readonly width: number;
}): RolloutOutcome {
  const { prm, expander, step, context, maxDepth, width } = input;
  let current = input.state;
  let runningSum = 0;
  let stepsTaken = 0;

  for (let d = 0; d < maxDepth; d += 1) {
    if (current.terminal) {
      return Object.freeze({
        value: stepsTaken === 0 ? 0.5 : runningSum / stepsTaken,
        depthReached: d,
        hitTerminal: true,
      });
    }
    const candidates = expander(current, width, context);
    if (candidates.length === 0) break;

    let best = candidates[0]!;
    let bestScore = -1;
    for (const cand of candidates) {
      const s = prm({ state: current, candidateStep: cand, context }).score;
      if (s > bestScore) {
        best = cand;
        bestScore = s;
      }
    }
    runningSum += bestScore;
    stepsTaken += 1;
    const advanced = step(current, best, context);
    current = advanced.nextState;
  }

  const value = stepsTaken === 0 ? 0.5 : runningSum / stepsTaken;
  return Object.freeze({
    value,
    depthReached: stepsTaken,
    hitTerminal: current.terminal,
  });
}
