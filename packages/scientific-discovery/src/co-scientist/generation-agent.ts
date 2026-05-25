/**
 * Generation agent — Co-Scientist agent #1 of 6.
 *
 * Role: propose new hypotheses, seeded by the SEED_LIBRARY and an LLM
 * that surveys recent anomalies / KG triples / market signals.
 *
 * Pure function over (seeds, llmClient, anomaly?). No I/O beyond
 * the injected LLM. Returns a fresh array, never mutates inputs.
 *
 * Reference:
 *   Google AI Co-Scientist — Generation agent role
 *   https://research.google/blog/accelerating-scientific-breakthroughs-with-an-ai-co-scientist/
 */

import type { Hypothesis, HypothesisSeed, LLMClient, Perspective } from '../types.js';

export interface GenerateInput {
  readonly seeds: readonly HypothesisSeed[];
  readonly llm: LLMClient;
  /** Optional anomaly context — narrows seed selection. */
  readonly anomalyArea?: HypothesisSeed['area'];
  /** Optional perspective override — narrows seed selection. */
  readonly perspective?: Perspective;
  /** How many hypotheses to emit; default = min(seeds.length, 8). */
  readonly count?: number;
  /** Stable id prefix so the same run is replayable. */
  readonly runId: string;
  /** ISO timestamp injected for determinism in tests. */
  readonly now: string;
}

export async function generateHypotheses(input: GenerateInput): Promise<readonly Hypothesis[]> {
  const filtered = filterSeeds(input.seeds, input.anomalyArea, input.perspective);
  const k = input.count ?? Math.min(filtered.length, 8);
  const slice = filtered.slice(0, k);

  // For each seed, ask the LLM to phrase it as a specific hypothesis
  // grounded in the (optional) anomaly area. We keep the LLM-rewrite
  // optional — if the LLM returns empty, we fall back to the seed
  // statement verbatim so the agent is always productive.
  const out: Hypothesis[] = [];
  for (let i = 0; i < slice.length; i += 1) {
    const seed = slice[i];
    if (!seed) continue;
    const rephrased = await rephraseViaLlm(seed, input.llm);
    out.push({
      id: `${input.runId}-h${i + 1}`,
      statement: rephrased || seed.statement,
      area: seed.area,
      owningPerspective: seed.owningPerspective,
      treatment: seed.suggestedTreatmentVar,
      outcome: seed.suggestedOutcomeVar,
      confounders: [...seed.suggestedConfounders],
      parentSeedId: seed.id,
      parentHypothesisId: null,
      createdAt: input.now,
    });
  }
  return out;
}

function filterSeeds(
  seeds: readonly HypothesisSeed[],
  area: HypothesisSeed['area'] | undefined,
  perspective: Perspective | undefined,
): readonly HypothesisSeed[] {
  return seeds.filter(
    (s) =>
      (area === undefined || s.area === area) &&
      (perspective === undefined || s.owningPerspective === perspective),
  );
}

async function rephraseViaLlm(seed: HypothesisSeed, llm: LLMClient): Promise<string> {
  const completion = await llm.complete({
    system:
      'You are a property-economics analyst. Rephrase a causal hypothesis seed ' +
      'into a single specific testable claim. Reply with ONE sentence and no preamble.',
    prompt: `Seed: ${seed.statement}\nTreatment: ${seed.suggestedTreatmentVar}\nOutcome: ${seed.suggestedOutcomeVar}`,
    maxTokens: 120,
    metadata: { agent: 'generation', seedId: seed.id },
  });
  return completion.text.trim();
}
