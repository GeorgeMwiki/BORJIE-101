/**
 * Expansion policy — wraps a caller-provided expansion fn with PRM
 * scoring, dedupe, and width clamping. See §3.3 of the spec.
 *
 * The caller's `ExpansionFn` is the only place we touch the LLM;
 * everything else in MCTS is pure search arithmetic.
 */

import type {
  ExpansionFn,
  MctsNode,
  PrmContext,
  PrmFn,
  ReasoningStep,
} from '../types.js';

export interface ScoredCandidate {
  readonly step: ReasoningStep;
  readonly priorScore: number;
}

export function expandWithScoring(input: {
  readonly parent: MctsNode;
  readonly expander: ExpansionFn;
  readonly prm: PrmFn;
  readonly context: PrmContext;
  readonly width: number;
}): ReadonlyArray<ScoredCandidate> {
  const { parent, expander, prm, context, width } = input;
  if (parent.state.terminal) return Object.freeze([]);

  const raw = expander(parent.state, width, context);
  const seen = new Set<string>();
  const scored: Array<ScoredCandidate> = [];

  for (const step of raw) {
    if (scored.length >= width) break;
    if (seen.has(step.id)) continue;
    seen.add(step.id);
    const prmOut = prm({
      state: parent.state,
      candidateStep: step,
      context,
    });
    scored.push(
      Object.freeze({
        step,
        priorScore: prmOut.score,
      }),
    );
  }

  return Object.freeze(scored);
}
