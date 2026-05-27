/**
 * Hybrid search — Reciprocal Rank Fusion (Cormack 2009) over the FTS
 * and dense retrievers.
 *
 * Algorithm:
 *
 *   For each result d in the union of (FTS top-k, dense top-k):
 *     rrf(d) = k1 / (k + rankFts(d)) + k2 / (k + rankDense(d))
 *
 *   where:
 *     - rank is 1-indexed (best is rank 1).
 *     - If d only appears in one list, the missing rank contributes 0.
 *     - `k`, `k1`, `k2` are read from HybridRetrievalConfig.
 *
 * Reference: Cormack, G. V., Clarke, C. L. A., Büttcher, S. (2009).
 *            Reciprocal rank fusion outperforms Condorcet and
 *            individual rank learning methods. SIGIR 2009.
 *            <https://doi.org/10.1145/1571941.1572114>.
 *
 * @module @borjie/blackboard-intel/search/hybrid-search
 */

import {
  DEFAULT_HYBRID_CONFIG,
  type HybridRetrievalConfig,
  type SearchQuery,
  type SearchResult,
} from '../types.js';
import { createFtsSearcher, type FtsSearcher } from './fts-search.js';
import { createDenseSearcher, type DenseSearcher } from './dense-search.js';

export interface HybridSearcherDeps {
  readonly fts: FtsSearcher;
  readonly dense: DenseSearcher;
  readonly config?: HybridRetrievalConfig;
}

export interface HybridSearcher {
  readonly search: (
    query: SearchQuery,
  ) => Promise<ReadonlyArray<SearchResult>>;
}

export function createHybridSearcher(
  deps: HybridSearcherDeps,
): HybridSearcher {
  const cfg = deps.config ?? DEFAULT_HYBRID_CONFIG;
  return {
    async search(
      query: SearchQuery,
    ): Promise<ReadonlyArray<SearchResult>> {
      const perRetrieverQuery: SearchQuery = {
        ...query,
        k: cfg.perRetrieverK,
      };
      const [ftsHits, denseHits] = await Promise.all([
        deps.fts.search(perRetrieverQuery),
        deps.dense.search(perRetrieverQuery),
      ]);
      const fused = reciprocalRankFusion(ftsHits, denseHits, cfg);
      const fusedK = query.k ?? cfg.fusedK;
      return Object.freeze(fused.slice(0, fusedK));
    },
  };
}

/**
 * Pure-data RRF combiner. Exported so the test fixture can reproduce
 * the Cormack 2009 reference vector without standing up the
 * searchers.
 */
export function reciprocalRankFusion(
  fts: ReadonlyArray<SearchResult>,
  dense: ReadonlyArray<SearchResult>,
  config: HybridRetrievalConfig,
): ReadonlyArray<SearchResult> {
  const acc: Map<
    string,
    {
      score: number;
      result: SearchResult;
      ftsRank: number | null;
      denseRank: number | null;
    }
  > = new Map();

  fts.forEach((r, idx) => {
    const rank = idx + 1;
    const contribution = config.k1 / (config.k + rank);
    const prev = acc.get(r.postId);
    if (prev === undefined) {
      acc.set(r.postId, {
        score: contribution,
        result: r,
        ftsRank: rank,
        denseRank: null,
      });
    } else {
      acc.set(r.postId, {
        ...prev,
        score: prev.score + contribution,
        ftsRank: rank,
      });
    }
  });

  dense.forEach((r, idx) => {
    const rank = idx + 1;
    const contribution = config.k2 / (config.k + rank);
    const prev = acc.get(r.postId);
    if (prev === undefined) {
      acc.set(r.postId, {
        score: contribution,
        result: r,
        ftsRank: null,
        denseRank: rank,
      });
    } else {
      acc.set(r.postId, {
        ...prev,
        score: prev.score + contribution,
        denseRank: rank,
      });
    }
  });

  const merged: SearchResult[] = [];
  for (const entry of acc.values()) {
    merged.push(
      Object.freeze({
        postId: entry.result.postId,
        tenantId: entry.result.tenantId,
        score: entry.score,
        snippet: entry.result.snippet,
        meta: Object.freeze({
          source: 'hybrid',
          ftsRank: entry.ftsRank,
          denseRank: entry.denseRank,
        }),
      }),
    );
  }

  // Stable descending by score; on ties prefer the FTS hit (lower
  // ftsRank). On further ties, prefer dense (lower denseRank).
  merged.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const af = a.meta['ftsRank'] as number | null;
    const bf = b.meta['ftsRank'] as number | null;
    if (af !== bf) return (af ?? Number.POSITIVE_INFINITY) -
      (bf ?? Number.POSITIVE_INFINITY);
    const ad = a.meta['denseRank'] as number | null;
    const bd = b.meta['denseRank'] as number | null;
    return (ad ?? Number.POSITIVE_INFINITY) -
      (bd ?? Number.POSITIVE_INFINITY);
  });

  return Object.freeze([...merged]);
}

/**
 * Convenience constructor that wires the searchers from their
 * underlying ports in one call.
 */
export function buildHybridSearcher(deps: {
  readonly fts: FtsSearcher;
  readonly dense: DenseSearcher;
  readonly config?: HybridRetrievalConfig;
}): HybridSearcher {
  return createHybridSearcher(deps);
}

// Re-exports for callers wiring searchers from raw ports.
export { createFtsSearcher, createDenseSearcher };
