/**
 * RRF reference vector — derived from Cormack, Clarke, Büttcher
 * (SIGIR 2009).
 *
 * The paper's §3 formula is `score(d) = Σ_i 1 / (k + rank_i(d))`
 * with `k = 60`. We construct a deterministic two-list example we
 * can verify by hand.
 *
 * Given:
 *   L1 (FTS):   [d1, d2, d3, d4, d5]   ranks 1..5
 *   L2 (dense): [d3, d1, d5, d2, d4]   ranks 1..5
 *
 * The per-document scores (k = 60, k1 = k2 = 1) are:
 *
 *   d1:  1/61 + 1/62  =  0.0163934 + 0.0161290 = 0.0325224
 *   d2:  1/62 + 1/64  =  0.0161290 + 0.0156250 = 0.0317540
 *   d3:  1/63 + 1/61  =  0.0158730 + 0.0163934 = 0.0322664
 *   d4:  1/64 + 1/65  =  0.0156250 + 0.0153846 = 0.0310096
 *   d5:  1/65 + 1/63  =  0.0153846 + 0.0158730 = 0.0312576
 *
 * Descending order:
 *   1. d1  (0.0325224)
 *   2. d3  (0.0322664)
 *   3. d2  (0.0317540)
 *   4. d5  (0.0312576)
 *   5. d4  (0.0310096)
 *
 * The hybrid-search test reproduces this exact order — any
 * divergence is a bug in the RRF implementation.
 *
 * @module @borjie/blackboard-intel/__fixtures__/rrf-reference-cormack-2009
 */

import type { SearchResult } from '../types.js';

const TENANT_ID = 'tenant-test';

function make(postId: string, rankScore: number): SearchResult {
  return Object.freeze({
    postId,
    tenantId: TENANT_ID,
    score: rankScore,
    snippet: `content for ${postId}`,
    meta: Object.freeze({ source: 'fixture' }),
  });
}

export const REFERENCE_FTS_LIST: ReadonlyArray<SearchResult> = Object.freeze([
  make('d1', 1.0),
  make('d2', 0.8),
  make('d3', 0.6),
  make('d4', 0.4),
  make('d5', 0.2),
]);

export const REFERENCE_DENSE_LIST: ReadonlyArray<SearchResult> = Object.freeze([
  make('d3', 0.95),
  make('d1', 0.90),
  make('d5', 0.85),
  make('d2', 0.80),
  make('d4', 0.75),
]);

export const EXPECTED_RRF_ORDER: ReadonlyArray<string> = Object.freeze([
  'd1',
  'd3',
  'd2',
  'd5',
  'd4',
]);

/** RRF scores rounded to 7 decimal places — handy for diagnostics. */
export const EXPECTED_RRF_SCORES: Readonly<Record<string, number>> =
  Object.freeze({
    d1: 0.0325224,
    d3: 0.0322664,
    d2: 0.0317540,
    d5: 0.0312576,
    d4: 0.0310096,
  });
