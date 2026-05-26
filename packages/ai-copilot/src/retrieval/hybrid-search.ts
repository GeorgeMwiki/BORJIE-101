/**
 * Hybrid Search — vector + BM25 + Reciprocal Rank Fusion (RRF).
 *
 * Top-level entrypoint for the retrieval pipeline. Pulls a candidate
 * set from BOTH a dense-vector retriever AND a BM25 lexical retriever
 * over the same chunk corpus, then fuses the two ranked lists.
 *
 * Fusion strategies:
 *   - 'rrf'    Reciprocal Rank Fusion (default). Score depends only on
 *              rank position, not magnitude. Robust to heterogeneous
 *              score distributions per Anthropic / Cohere benchmarks.
 *              `score(d) = sum over lists L of (1 / (k + rank_L(d)))`
 *              with k = 60 (Cormack 2009 reference value).
 *   - 'convex' Min-max normalise BM25, then weighted sum with vector:
 *              `score = alpha * vector + (1 - alpha) * bm25_norm`.
 *              Legacy LITFIN behaviour; useful for back-compat with
 *              callers that already calibrated their alpha.
 *
 * The LITFIN source (`bm25-hybrid.ts`) shipped convex-only with a
 * hardcoded alpha=0.5; the BORJIE port closes that gap by making
 * RRF the default and exposing the strategy on the public surface.
 *
 * The module is pure: no I/O. Vector candidates and chunk corpus are
 * BOTH injected. Wiring this to pgvector / Pinecone / Qdrant is done
 * one layer up by the consuming service.
 *
 * @module @borjie/ai-copilot/retrieval/hybrid-search
 */

import {
  buildBM25Index,
  scoreBM25,
  type BM25Index,
} from './bm25.js';
import type {
  Chunk,
  FusionStrategy,
  HybridAlpha,
  RetrievalHit,
} from './types.js';

// ===========================================================================
// Constants
// ===========================================================================

/** Cormack 2009 RRF constant. Empirically robust across a wide range
 *  of retrieval tasks; not worth re-tuning for the property-management
 *  corpus until we have a labelled dev set. */
const RRF_K = 60;

/** Default convex-combination weight on the vector signal. Equal-
 *  weight fusion was strongest on Anthropic's contextual-retrieval
 *  ablation. */
const DEFAULT_ALPHA: HybridAlpha = 0.5;

// ===========================================================================
// Types
// ===========================================================================

/**
 * One candidate as observed by the vector retriever. The pipeline
 * accepts an EXTERNAL vector-similarity score because vector retrieval
 * normally happens in the database (pgvector `<=>` cosine, Pinecone
 * topK, etc.) — this module's job is to FUSE, not to embed.
 */
export interface VectorCandidate {
  /** The chunk id; must match `Chunk.id`. */
  readonly id: string;
  /** Cosine similarity (or equivalent) in [0, 1]. */
  readonly score: number;
}

export interface HybridSearchInput {
  /** The query text — used to tokenise + score against the BM25 index. */
  readonly query: string;
  /** The dense-vector retriever's top candidates. */
  readonly vectorCandidates: ReadonlyArray<VectorCandidate>;
  /** The corpus the BM25 index will be built over. Pass the SAME chunk
   *  set the vector retriever indexed; otherwise the fusion sees
   *  disjoint id-spaces and degrades to vector-only. */
  readonly chunks: ReadonlyArray<Chunk>;
  /** Top-k to return after fusion. */
  readonly topK: number;
  /** Fusion strategy. Default 'rrf'. */
  readonly fusion?: FusionStrategy;
  /** Convex-fusion alpha. Only consulted when fusion === 'convex'. */
  readonly alpha?: HybridAlpha;
  /** Minimum score floor; results below are dropped. Default 0. */
  readonly minScore?: number;
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Run hybrid search: build a per-call BM25 index over `chunks`, score
 * the query against it, then fuse the BM25 ranks with the supplied
 * `vectorCandidates`.
 *
 * For large corpora, prefer the lower-level `scoreBM25` + `fuseRRF` /
 * `fuseConvex` building blocks so the BM25 index is built once and
 * reused. For small per-document searches this convenience function
 * is cheap and ergonomic.
 */
export function hybridSearch(input: HybridSearchInput): ReadonlyArray<RetrievalHit> {
  const fusion: FusionStrategy = input.fusion ?? 'rrf';
  const topK = Math.max(1, input.topK);
  const minScore = input.minScore ?? 0;

  // Build BM25 index for the corpus.
  const bm25Index: BM25Index = buildBM25Index(
    input.chunks.map((c) => ({ id: c.id, text: c.text })),
  );
  const bm25Scored = scoreBM25(input.query, bm25Index);

  const chunkById = new Map<string, Chunk>();
  for (const c of input.chunks) chunkById.set(c.id, c);

  // Lookup tables: id -> raw vector score, id -> raw BM25 score, and
  // id -> rank position in each list (for RRF).
  const vectorScoreById = new Map<string, number>();
  const vectorRankById = new Map<string, number>();
  for (let i = 0; i < input.vectorCandidates.length; i++) {
    const c = input.vectorCandidates[i];
    if (c === undefined) continue;
    vectorScoreById.set(c.id, c.score);
    vectorRankById.set(c.id, i + 1); // 1-based rank
  }

  const bm25ScoreById = new Map<string, number>();
  const bm25RankById = new Map<string, number>();
  for (let i = 0; i < bm25Scored.length; i++) {
    const s = bm25Scored[i];
    if (s === undefined) continue;
    bm25ScoreById.set(s.id, s.score);
    bm25RankById.set(s.id, i + 1);
  }

  // Union of candidate ids.
  const ids = new Set<string>();
  for (const id of vectorScoreById.keys()) ids.add(id);
  for (const id of bm25ScoreById.keys()) ids.add(id);

  const fused: Array<RetrievalHit> = [];
  for (const id of ids) {
    const chunk = chunkById.get(id);
    if (!chunk) continue;
    const vScore = vectorScoreById.get(id) ?? 0;
    const bScore = bm25ScoreById.get(id) ?? 0;
    const vRank = vectorRankById.get(id);
    const bRank = bm25RankById.get(id);

    let score: number;
    if (fusion === 'rrf') {
      score = rrfContribution(vRank) + rrfContribution(bRank);
    } else {
      score = convexFuse(
        vScore,
        bScore,
        bm25Scored.length > 0 ? (bm25Scored[0]?.score ?? 0) : 0,
        bm25Scored.length > 0
          ? (bm25Scored[bm25Scored.length - 1]?.score ?? 0)
          : 0,
        input.alpha ?? DEFAULT_ALPHA,
      );
    }

    if (score < minScore) continue;
    fused.push({
      chunk,
      score,
      vectorScore: vScore,
      bm25Score: bScore,
    });
  }

  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, topK);
}

// ===========================================================================
// Fusion primitives
// ===========================================================================

/**
 * Reciprocal Rank Fusion contribution from a single ranked list.
 * `undefined` rank → the doc didn't appear in this list → contribution
 * is zero (NOT `1 / (k + Infinity)` which would be a vanishingly small
 * positive number; zero is cleaner and matches the Cormack 2009 paper).
 */
export function rrfContribution(rank: number | undefined): number {
  if (rank === undefined || rank <= 0) return 0;
  return 1 / (RRF_K + rank);
}

/**
 * Combine the per-list reciprocal-rank contributions from many lists
 * into a single RRF score. Lists in which the doc does NOT appear
 * should pass `undefined` for that doc's rank.
 */
export function fuseRRF(
  perListRanks: ReadonlyArray<number | undefined>,
): number {
  let total = 0;
  for (const r of perListRanks) total += rrfContribution(r);
  return total;
}

/**
 * Convex combination of a single vector score with a BM25 score that
 * is min-max normalised against the BM25 score range observed in the
 * candidate set. Exported as a primitive for callers that want to roll
 * their own fusion outside `hybridSearch`.
 */
export function convexFuse(
  vectorScore: number,
  bm25Score: number,
  bm25Max: number,
  bm25Min: number,
  alpha: HybridAlpha = DEFAULT_ALPHA,
): number {
  const a = clampAlpha(alpha);
  const denom = bm25Max - bm25Min;
  const norm =
    denom > 0
      ? (bm25Score - bm25Min) / denom
      : bm25Score > 0
        ? 1
        : 0;
  return a * vectorScore + (1 - a) * norm;
}

function clampAlpha(alpha: number): number {
  if (!Number.isFinite(alpha)) return DEFAULT_ALPHA;
  if (alpha < 0) return 0;
  if (alpha > 1) return 1;
  return alpha;
}

// ===========================================================================
// Convenience constants
// ===========================================================================

export const RRF_K_CONSTANT = RRF_K;
export const DEFAULT_HYBRID_ALPHA = DEFAULT_ALPHA;
