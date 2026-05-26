/**
 * Relevance scorer — Discipline 5, stage 1.
 *
 * Scores candidate context items against the current intent + utterance.
 * Two strategies: deterministic keyword overlap (cheap, always runs) and
 * an optional embedding-similarity port (caller-wired). The scorer is
 * monotonic — adding more context can only raise scores, never lower
 * them.
 *
 * @module @borjie/cognitive-engine/relevance/relevance-scorer
 */

export interface ContextItem {
  readonly ref_id: string;
  readonly kind: string;
  readonly summary: string;
  /** Estimated token cost if included in the prompt. */
  readonly token_cost: number;
}

export interface ScoredContextItem extends ContextItem {
  readonly score: number;
}

export interface EmbeddingSimilarityPort {
  readonly score: (
    utterance: string,
    summaries: ReadonlyArray<string>,
  ) => Promise<ReadonlyArray<number>>;
}

const STOPWORDS = new Set<string>([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'is',
  'are',
  'was',
  'were',
  'be',
  'this',
  'that',
  'for',
  'with',
  'by',
  'from',
  'as',
  'at',
]);

export function tokenize(s: string): ReadonlySet<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

/** Jaccard overlap — fast, no external deps. */
export function keywordScore(utterance: string, summary: string): number {
  const a = tokenize(utterance);
  const b = tokenize(summary);
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect += 1;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

export async function scoreRelevance(
  utterance: string,
  candidates: ReadonlyArray<ContextItem>,
  embedding?: EmbeddingSimilarityPort,
): Promise<ReadonlyArray<ScoredContextItem>> {
  if (candidates.length === 0) return [];
  const keywordScores = candidates.map((c) => keywordScore(utterance, c.summary));
  if (embedding === undefined) {
    return candidates.map((c, i) => ({ ...c, score: keywordScores[i] ?? 0 }));
  }
  const embScores = await embedding.score(
    utterance,
    candidates.map((c) => c.summary),
  );
  return candidates.map((c, i) => {
    const ks = keywordScores[i] ?? 0;
    const es = embScores[i] ?? 0;
    return { ...c, score: 0.4 * ks + 0.6 * es };
  });
}
