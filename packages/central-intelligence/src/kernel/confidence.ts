/**
 * Confidence — composite scoring of a sensor output.
 *
 * Four components, all in [0,1]:
 *
 *   1. groundedness         — fraction of factual sentences that
 *                              cite at least one tool result
 *   2. stability            — similarity between this output and a
 *                              re-roll (when stakes ≥ high we re-roll)
 *   3. review               — judge pass score, defaults to 1 when
 *                              the judge did not run
 *   4. numericalConsistency — every number in the reply that
 *                              matches a number in a tool result
 *
 * The overall confidence is min(...components) — a single weak link
 * dominates the answer's trust.
 */

import type { ConfidenceVector } from './kernel-types.js';

export interface ConfidenceInput {
  readonly outputText: string;
  readonly citationCount: number;
  readonly toolResultNumbers: ReadonlyArray<number>;
  readonly judgeScore: number | null;            // null if no judge ran
  readonly rerolledOutputText: string | null;    // null if no re-roll
}

export function scoreConfidence(input: ConfidenceInput): ConfidenceVector {
  const groundedness = scoreGroundedness(input.outputText, input.citationCount);
  const stability = scoreStability(input.outputText, input.rerolledOutputText);
  const review = input.judgeScore ?? 1;
  const numericalConsistency = scoreNumerical(input.outputText, input.toolResultNumbers);

  const overall = Math.min(groundedness, stability, review, numericalConsistency);

  return { groundedness, stability, review, numericalConsistency, overall };
}

const SENTENCE_SPLIT = /[.!?]+(?:\s+|$)/;
// A "factual" sentence has a number, a proper-noun-like token, or a
// concrete claim verb. The heuristic is intentionally permissive.
const FACTUAL_SIGNALS = /(\d|\$|TZS|KES|USD|%|tenant|lease|unit|block|property|owner|arrears|rent|vacancy)/i;

function scoreGroundedness(text: string, citations: number): number {
  if (!text.trim()) return 1;
  const sentences = text.split(SENTENCE_SPLIT).filter((s) => s.trim().length > 0);
  if (sentences.length === 0) return 1;
  const factual = sentences.filter((s) => FACTUAL_SIGNALS.test(s));
  if (factual.length === 0) return 1;
  // 1 citation per factual sentence = 1.0; saturating ratio.
  const ratio = Math.min(1, citations / factual.length);
  return ratio;
}

function scoreStability(a: string, b: string | null): number {
  if (!b) return 1; // no re-roll requested → trust the single shot
  return jaccardSimilarity(tokenSet(a), tokenSet(b));
}

function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

const NUMBER_RE = /-?\d+(?:[.,]\d+)?/g;

function scoreNumerical(text: string, allowed: ReadonlyArray<number>): number {
  const matches = text.match(NUMBER_RE) ?? [];
  if (matches.length === 0) return 1;
  const allowedSet = new Set(allowed.map((n) => normaliseNum(String(n))));
  let consistent = 0;
  for (const m of matches) {
    if (allowedSet.has(normaliseNum(m))) consistent++;
  }
  return consistent / matches.length;
}

function normaliseNum(s: string): string {
  return s.replace(/,/g, '').replace(/\.0+$/, '');
}
