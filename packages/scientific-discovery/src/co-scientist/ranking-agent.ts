/**
 * Ranking agent — Co-Scientist agent #3 of 6.
 *
 * Role: Elo-style pairwise tournament between hypotheses. The LLM
 * acts as the judge for each pairing ("which of A vs B is the more
 * actionable causal claim, controlling for the same confounders?").
 *
 * Pure function over (hypotheses, llmClient).
 *
 * Elo update math:
 *   expected = 1 / (1 + 10^((rating_B - rating_A) / 400))
 *   rating_A' = rating_A + K * (actualA - expected)
 *   K = 32 (chess-classic default — adequate for small populations)
 *
 * Reference:
 *   Co-Scientist "idea tournament" — Section 4 of the Google Research blog.
 */

import type { EloEntry, Hypothesis, LLMClient, RankedHypothesis } from '../types.js';

const INITIAL_RATING = 1200;
const K_FACTOR = 32;

export interface RankInput {
  readonly hypotheses: readonly Hypothesis[];
  readonly llm: LLMClient;
  /** Cap number of pairings (each is one LLM call). Default = N*(N-1)/2. */
  readonly maxPairings?: number;
}

export async function rankHypotheses(input: RankInput): Promise<readonly RankedHypothesis[]> {
  const { hypotheses, llm } = input;
  const elo = new Map<string, EloEntry>();
  for (const h of hypotheses) {
    elo.set(h.id, {
      hypothesisId: h.id,
      rating: INITIAL_RATING,
      wins: 0,
      losses: 0,
      draws: 0,
    });
  }

  const pairings = enumeratePairings(hypotheses, input.maxPairings);

  for (const [a, b] of pairings) {
    const winner = await judgePair(a, b, llm);
    applyEloUpdate(elo, a.id, b.id, winner);
  }

  // Return ranked descending by rating; stable for ties (insertion-order).
  return hypotheses
    .map((h) => ({ hypothesis: h, elo: elo.get(h.id) as EloEntry }))
    .sort((x, y) => y.elo.rating - x.elo.rating);
}

/**
 * Apply a single Elo update. Exported for testing the maths in isolation.
 */
export function applyEloUpdate(
  table: Map<string, EloEntry>,
  aId: string,
  bId: string,
  outcome: 'a' | 'b' | 'draw',
): void {
  const a = table.get(aId);
  const b = table.get(bId);
  if (!a || !b) return;
  const expectedA = 1 / (1 + Math.pow(10, (b.rating - a.rating) / 400));
  const expectedB = 1 - expectedA;
  const actualA = outcome === 'a' ? 1 : outcome === 'b' ? 0 : 0.5;
  const actualB = 1 - actualA;
  table.set(aId, {
    ...a,
    rating: a.rating + K_FACTOR * (actualA - expectedA),
    wins: a.wins + (outcome === 'a' ? 1 : 0),
    losses: a.losses + (outcome === 'b' ? 1 : 0),
    draws: a.draws + (outcome === 'draw' ? 1 : 0),
  });
  table.set(bId, {
    ...b,
    rating: b.rating + K_FACTOR * (actualB - expectedB),
    wins: b.wins + (outcome === 'b' ? 1 : 0),
    losses: b.losses + (outcome === 'a' ? 1 : 0),
    draws: b.draws + (outcome === 'draw' ? 1 : 0),
  });
}

function enumeratePairings(
  hypotheses: readonly Hypothesis[],
  cap: number | undefined,
): ReadonlyArray<readonly [Hypothesis, Hypothesis]> {
  const out: Array<readonly [Hypothesis, Hypothesis]> = [];
  for (let i = 0; i < hypotheses.length; i += 1) {
    for (let j = i + 1; j < hypotheses.length; j += 1) {
      const a = hypotheses[i];
      const b = hypotheses[j];
      if (a && b) out.push([a, b]);
      if (cap !== undefined && out.length >= cap) return out;
    }
  }
  return out;
}

async function judgePair(
  a: Hypothesis,
  b: Hypothesis,
  llm: LLMClient,
): Promise<'a' | 'b' | 'draw'> {
  const completion = await llm.complete({
    system:
      'You are a tournament judge. Given two property-economics hypotheses, pick ' +
      'the one with stronger actionability and identifiability. Reply ONLY with one ' +
      'of "A", "B", or "DRAW".',
    prompt: [
      `A: ${a.statement} (treatment=${a.treatment}, outcome=${a.outcome})`,
      `B: ${b.statement} (treatment=${b.treatment}, outcome=${b.outcome})`,
    ].join('\n'),
    maxTokens: 8,
    metadata: { agent: 'ranking', a: a.id, b: b.id },
  });
  const verdict = completion.text.trim().toUpperCase();
  if (verdict.startsWith('A')) return 'a';
  if (verdict.startsWith('B')) return 'b';
  return 'draw';
}
