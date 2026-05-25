/**
 * Evolution agent — Co-Scientist agent #4 of 6.
 *
 * Role: mutate / combine top-k hypotheses to produce next-generation
 * candidates. Inspired by FunSearch's island-model population.
 *
 * Pure function over (rankedHypotheses, llmClient).
 *
 * References:
 *   - Co-Scientist evolution role
 *   - FunSearch (DeepMind, 2024)
 *     https://deepmind.google/discover/blog/funsearch-making-new-discoveries-in-mathematical-sciences-using-large-language-models/
 */

import type { Hypothesis, LLMClient, RankedHypothesis } from '../types.js';

export interface EvolveInput {
  readonly ranked: readonly RankedHypothesis[];
  readonly llm: LLMClient;
  /** How many top hypotheses to evolve. */
  readonly topK?: number;
  /** Mutations per parent. */
  readonly mutationsPerParent?: number;
  readonly runId: string;
  readonly now: string;
}

export async function evolveHypotheses(input: EvolveInput): Promise<readonly Hypothesis[]> {
  const topK = input.topK ?? 3;
  const mutationsPerParent = input.mutationsPerParent ?? 2;
  const parents = input.ranked.slice(0, topK).map((r) => r.hypothesis);

  const out: Hypothesis[] = [];
  let idx = 0;
  for (const parent of parents) {
    for (let m = 0; m < mutationsPerParent; m += 1) {
      idx += 1;
      const mutated = await mutateOne(parent, m, input.llm);
      out.push({
        id: `${input.runId}-evo${idx}`,
        statement: mutated || parent.statement,
        area: parent.area,
        owningPerspective: parent.owningPerspective,
        treatment: parent.treatment,
        outcome: parent.outcome,
        confounders: [...parent.confounders],
        parentSeedId: parent.parentSeedId,
        parentHypothesisId: parent.id,
        createdAt: input.now,
      });
    }
  }
  return out;
}

async function mutateOne(parent: Hypothesis, variant: number, llm: LLMClient): Promise<string> {
  const completion = await llm.complete({
    system:
      'You evolve scientific hypotheses. Produce ONE specific mutation of the parent ' +
      'hypothesis: narrow the population, add an interaction term, or shift the ' +
      'threshold. Reply with ONE sentence only.',
    prompt: `Parent: ${parent.statement}\nVariant index: ${variant}`,
    maxTokens: 120,
    metadata: { agent: 'evolution', parent: parent.id, variant: String(variant) },
  });
  return completion.text.trim();
}
