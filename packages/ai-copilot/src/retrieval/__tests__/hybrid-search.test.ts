/**
 * Tests for retrieval/hybrid-search.
 *
 * Covers:
 *   1. BM25 primitives: tokenize, buildBM25Index, scoreBM25.
 *   2. RRF primitives: rrfContribution, fuseRRF.
 *   3. Convex primitive: convexFuse with alpha boundaries.
 *   4. hybridSearch RRF: docs ranked higher in BOTH lists win.
 *   5. hybridSearch RRF: a doc only in vector list still surfaces (with
 *      non-zero score) — does not require BM25 presence.
 *   6. hybridSearch RRF: a doc only in BM25 list still surfaces.
 *   7. hybridSearch convex: alpha=1.0 ignores BM25 entirely; alpha=0.0
 *      ignores vector entirely.
 *   8. minScore floor drops below-threshold hits.
 *   9. topK clamps the result count.
 *  10. Empty corpus returns empty result.
 */

import { describe, it, expect } from 'vitest';
import {
  buildBM25Index,
  scoreBM25,
  searchBM25,
  tokenize,
  type BM25Document,
} from '../bm25.js';
import {
  convexFuse,
  fuseRRF,
  hybridSearch,
  rrfContribution,
} from '../hybrid-search.js';
import type { Chunk } from '../types.js';

// ===========================================================================
// BM25 primitives
// ===========================================================================

const CORPUS: ReadonlyArray<BM25Document> = [
  { id: 'd1', text: 'Lease rent is TZS 850,000 per month for Unit A.' },
  { id: 'd2', text: 'The tenant runs a small dairy products shop.' },
  { id: 'd3', text: 'Repayment schedule spans 24 months at TZS 200,000.' },
];

describe('retrieval/bm25 / tokenize', () => {
  it('lowercases and drops punctuation', () => {
    expect(tokenize('Hello, World!')).toEqual(['hello', 'world']);
  });

  it('preserves digit-only tokens', () => {
    const t = tokenize('TZS 850,000');
    expect(t).toContain('tzs');
    expect(t).toContain('850');
    expect(t).toContain('000');
  });
});

describe('retrieval/bm25 / index', () => {
  it('records per-doc length and doc-freq', () => {
    const idx = buildBM25Index(CORPUS);
    expect(idx.totalDocs).toBe(3);
    expect(idx.docLengths.get('d1')).toBeGreaterThan(0);
    expect(idx.docFreq.get('tzs')).toBe(2); // d1 + d3
    expect(idx.docFreq.get('dairy')).toBe(1); // only d2
  });
});

describe('retrieval/bm25 / scoreBM25', () => {
  it('ranks the doc with the rare query term first', () => {
    const idx = buildBM25Index(CORPUS);
    const scored = scoreBM25('dairy products', idx);
    expect(scored.length).toBeGreaterThan(0);
    expect(scored[0].id).toBe('d2');
  });

  it('returns empty list when no terms match', () => {
    const idx = buildBM25Index(CORPUS);
    expect(scoreBM25('zzz qqq', idx)).toEqual([]);
  });

  it('searchBM25 returns the top-k correctly', () => {
    const result = searchBM25('repayment schedule', CORPUS, 2);
    expect(result.length).toBeLessThanOrEqual(2);
    expect(result[0].id).toBe('d3');
  });
});

// ===========================================================================
// RRF primitives
// ===========================================================================

describe('retrieval/hybrid-search / RRF primitives', () => {
  it('rrfContribution returns 0 for undefined rank', () => {
    expect(rrfContribution(undefined)).toBe(0);
    expect(rrfContribution(0)).toBe(0);
  });

  it('rrfContribution decreases with rank', () => {
    expect(rrfContribution(1)).toBeGreaterThan(rrfContribution(2));
    expect(rrfContribution(2)).toBeGreaterThan(rrfContribution(10));
  });

  it('fuseRRF sums per-list contributions', () => {
    const both = fuseRRF([1, 1]);
    const single = fuseRRF([1, undefined]);
    expect(both).toBeGreaterThan(single);
  });
});

// ===========================================================================
// Convex primitive
// ===========================================================================

describe('retrieval/hybrid-search / convexFuse', () => {
  it('alpha=1.0 returns pure vector score', () => {
    expect(convexFuse(0.9, 5, 10, 0, 1.0)).toBe(0.9);
  });

  it('alpha=0.0 returns pure normalised BM25', () => {
    // bm25=5, range 0..10 → normalised 0.5
    expect(convexFuse(0.9, 5, 10, 0, 0.0)).toBeCloseTo(0.5);
  });

  it('alpha clamps to [0,1] when out of range', () => {
    expect(convexFuse(0.9, 5, 10, 0, 5)).toBe(0.9); // clamped to 1.0
    expect(convexFuse(0.9, 5, 10, 0, -3)).toBeCloseTo(0.5); // clamped to 0
  });
});

// ===========================================================================
// hybridSearch
// ===========================================================================

const CHUNKS: ReadonlyArray<Chunk> = [
  { id: 'c1', text: 'Lease rent is TZS 850,000 per month for Unit A.' },
  { id: 'c2', text: 'The tenant runs a small dairy products shop.' },
  { id: 'c3', text: 'Repayment schedule spans 24 months at TZS 200,000.' },
  { id: 'c4', text: 'Drought is the dominant downside risk for tenants.' },
];

describe('retrieval/hybrid-search / hybridSearch RRF', () => {
  it('ranks a doc present in BOTH lists higher than singletons', () => {
    const result = hybridSearch({
      query: 'dairy products shop',
      vectorCandidates: [
        { id: 'c2', score: 0.9 }, // top of vector list
        { id: 'c1', score: 0.4 },
      ],
      chunks: CHUNKS,
      topK: 3,
      fusion: 'rrf',
    });

    expect(result.length).toBeGreaterThan(0);
    // c2 is rank-1 in vector AND rank-1 in BM25 — must win.
    expect(result[0].chunk.id).toBe('c2');
    expect(result[0].score).toBeGreaterThan(0);
    expect(result[0].vectorScore).toBeCloseTo(0.9);
    expect(result[0].bm25Score).toBeGreaterThan(0);
  });

  it('surfaces a vector-only doc with a positive RRF score', () => {
    const result = hybridSearch({
      query: 'unrelated nonsense topic',
      vectorCandidates: [{ id: 'c4', score: 0.85 }],
      chunks: CHUNKS,
      topK: 5,
      fusion: 'rrf',
    });
    expect(result.length).toBe(1);
    expect(result[0].chunk.id).toBe('c4');
    expect(result[0].score).toBeGreaterThan(0);
    expect(result[0].bm25Score).toBe(0);
  });

  it('surfaces a BM25-only doc with a positive RRF score', () => {
    const result = hybridSearch({
      query: 'dairy products shop',
      vectorCandidates: [], // no vector hits at all
      chunks: CHUNKS,
      topK: 5,
      fusion: 'rrf',
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].chunk.id).toBe('c2');
    expect(result[0].vectorScore).toBe(0);
  });

  it('honours topK', () => {
    const result = hybridSearch({
      query: 'tzs',
      vectorCandidates: [
        { id: 'c1', score: 0.9 },
        { id: 'c2', score: 0.5 },
        { id: 'c3', score: 0.4 },
        { id: 'c4', score: 0.2 },
      ],
      chunks: CHUNKS,
      topK: 2,
      fusion: 'rrf',
    });
    expect(result.length).toBe(2);
  });

  it('drops hits below minScore floor', () => {
    const result = hybridSearch({
      query: 'tzs',
      vectorCandidates: [
        { id: 'c1', score: 0.1 },
        { id: 'c4', score: 0.1 },
      ],
      chunks: CHUNKS,
      topK: 5,
      fusion: 'rrf',
      // RRF contribution for rank-1 is 1/61 ≈ 0.0164. Setting the
      // floor to 0.05 should drop everything since neither doc reaches
      // it solo, but c1 IS in BM25 too so its sum may still pass.
      minScore: 1.0,
    });
    expect(result.length).toBe(0);
  });

  it('empty corpus returns empty result', () => {
    const result = hybridSearch({
      query: 'anything',
      vectorCandidates: [],
      chunks: [],
      topK: 5,
      fusion: 'rrf',
    });
    expect(result).toEqual([]);
  });
});

describe('retrieval/hybrid-search / hybridSearch convex', () => {
  it('alpha=1.0 ignores BM25 entirely', () => {
    const result = hybridSearch({
      query: 'dairy products shop', // BM25 favours c2
      vectorCandidates: [
        { id: 'c1', score: 0.99 }, // vector strongly favours c1
        { id: 'c2', score: 0.1 },
      ],
      chunks: CHUNKS,
      topK: 5,
      fusion: 'convex',
      alpha: 1.0,
    });
    expect(result[0].chunk.id).toBe('c1');
  });

  it('alpha=0.0 ignores vector entirely', () => {
    const result = hybridSearch({
      query: 'dairy products shop', // BM25 favours c2
      vectorCandidates: [
        { id: 'c1', score: 0.99 },
        { id: 'c2', score: 0.1 },
      ],
      chunks: CHUNKS,
      topK: 5,
      fusion: 'convex',
      alpha: 0.0,
    });
    expect(result[0].chunk.id).toBe('c2');
  });
});
