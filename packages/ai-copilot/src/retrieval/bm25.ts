/**
 * BM25 — pure-TS lexical retrieval primitive.
 *
 * Pairs with the dense-vector index to form a hybrid retriever (see
 * `./hybrid-search`). BM25 anchors on literal tokens — embeddings lose
 * exact-token signal so "TSH 4,250,000" gets embedded as a generic
 * money concept rather than that specific amount. Numeric / proper-
 * noun matches stay reliable on the lexical side.
 *
 * Implementation notes:
 *   - Robertson IDF (`log((N - df + 0.5) / (df + 0.5) + 1)`) — matches
 *     the rank_bm25 / Anthropic reference.
 *   - k1 = 1.5, b = 0.75 (Anthropic Contextual Retrieval ablation
 *     defaults).
 *   - Tokeniser is intentionally simple: lowercase ASCII alphanumeric,
 *     no stemming. Swahili + English vocabulary overlaps heavily in the
 *     property-management lexicon and aggressive stemming hurts the
 *     literal-anchor benefit we're buying.
 *
 * Ported from LITFIN `src/core/document-intelligence/contextual-rag/
 * bm25-hybrid.ts` (the BM25 portion only — fusion lives in
 * `./hybrid-search`).
 *
 * @module @borjie/ai-copilot/retrieval/bm25
 */

// ===========================================================================
// Constants
// ===========================================================================

/** Free parameter k1. Controls term-frequency saturation. */
const BM25_K1 = 1.5;
/** Free parameter b. Controls length normalisation. */
const BM25_B = 0.75;

// ===========================================================================
// Types
// ===========================================================================

export interface BM25Document {
  readonly id: string;
  readonly text: string;
}

export interface BM25Score {
  readonly id: string;
  readonly score: number;
}

export interface BM25Index {
  /** Average document length across the corpus (tokens). */
  readonly avgDocLength: number;
  /** Document length keyed by doc id (tokens). */
  readonly docLengths: ReadonlyMap<string, number>;
  /** Term-frequency map per document: docId -> term -> count. */
  readonly termFreq: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Document frequency for each term across the corpus. */
  readonly docFreq: ReadonlyMap<string, number>;
  /** Inverse document frequency for each term (pre-computed). */
  readonly idf: ReadonlyMap<string, number>;
  /** Total documents in the corpus. */
  readonly totalDocs: number;
}

// ===========================================================================
// Tokenization
// ===========================================================================

/**
 * Tokenise a string into lowercase alphanumeric tokens. Punctuation is
 * dropped (replaced with whitespace). `_` is preserved because chunk
 * ids and some identifiers use it. Tokens longer than 64 chars are
 * dropped (defensive against accidentally concatenated blobs).
 */
export function tokenize(text: string): ReadonlyArray<string> {
  if (!text) return [];
  const lowered = text.toLowerCase();
  const cleaned = lowered.replace(/[^a-z0-9_\s]/g, ' ');
  return cleaned
    .split(/\s+/u)
    .filter((token) => token.length > 0 && token.length < 64);
}

// ===========================================================================
// Index build
// ===========================================================================

/**
 * Build a BM25 index from a corpus. Cost is O(sum(|doc|)). For larger
 * corpora call this ONCE and reuse the index across many queries; for
 * per-document one-shot search use `searchBM25` below.
 */
export function buildBM25Index(
  docs: ReadonlyArray<BM25Document>,
): BM25Index {
  const docLengths = new Map<string, number>();
  const termFreq = new Map<string, Map<string, number>>();
  const docFreq = new Map<string, number>();

  for (const doc of docs) {
    const tokens = tokenize(doc.text);
    docLengths.set(doc.id, tokens.length);
    const tf = new Map<string, number>();
    const seen = new Set<string>();
    for (const tok of tokens) {
      tf.set(tok, (tf.get(tok) ?? 0) + 1);
      if (!seen.has(tok)) {
        seen.add(tok);
        docFreq.set(tok, (docFreq.get(tok) ?? 0) + 1);
      }
    }
    termFreq.set(doc.id, tf);
  }

  const totalDocs = docs.length;
  const totalTokens = [...docLengths.values()].reduce((a, b) => a + b, 0);
  const avgDocLength = totalDocs > 0 ? totalTokens / totalDocs : 0;

  // Pre-compute IDF per term so scoring is O(|q|) per doc.
  const idf = new Map<string, number>();
  for (const [term, df] of docFreq) {
    const v = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
    idf.set(term, v);
  }

  return {
    avgDocLength,
    docLengths,
    termFreq,
    docFreq,
    idf,
    totalDocs,
  };
}

// ===========================================================================
// Scoring
// ===========================================================================

/**
 * Score every doc in the index against the query. Returns the docs
 * with non-zero score, ordered highest-first. Zero-scoring docs are
 * dropped so callers don't have to filter.
 */
export function scoreBM25(
  query: string,
  index: BM25Index,
): ReadonlyArray<BM25Score> {
  const tokens = tokenize(query);
  if (tokens.length === 0 || index.totalDocs === 0) return [];

  const scored: Array<BM25Score> = [];
  for (const [docId, tf] of index.termFreq) {
    const length = index.docLengths.get(docId) ?? 0;
    const lenRatio =
      index.avgDocLength > 0 ? length / index.avgDocLength : 1;
    let score = 0;
    for (const term of tokens) {
      const idf = index.idf.get(term);
      if (idf === undefined) continue;
      const tfTerm = tf.get(term) ?? 0;
      if (tfTerm === 0) continue;
      const numerator = tfTerm * (BM25_K1 + 1);
      const denominator =
        tfTerm + BM25_K1 * (1 - BM25_B + BM25_B * lenRatio);
      score += idf * (numerator / denominator);
    }
    if (score > 0) scored.push({ id: docId, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ===========================================================================
// Convenience — one-shot search
// ===========================================================================

/**
 * Convenience entrypoint: tokenise, build an index, score, return the
 * top-k. Use when the corpus is small / per-document. For larger
 * corpora build the index once with `buildBM25Index` and reuse it.
 */
export function searchBM25(
  query: string,
  docs: ReadonlyArray<BM25Document>,
  limit = 20,
): ReadonlyArray<BM25Score> {
  const index = buildBM25Index(docs);
  const scored = scoreBM25(query, index);
  return scored.slice(0, Math.max(1, limit));
}
