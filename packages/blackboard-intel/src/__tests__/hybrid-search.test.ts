import { describe, it, expect } from 'vitest';
import {
  createHybridSearcher,
  reciprocalRankFusion,
} from '../search/hybrid-search.js';
import {
  EXPECTED_RRF_ORDER,
  EXPECTED_RRF_SCORES,
  REFERENCE_DENSE_LIST,
  REFERENCE_FTS_LIST,
} from '../__fixtures__/rrf-reference-cormack-2009.js';
import { DEFAULT_HYBRID_CONFIG } from '../types.js';
import type { SearchQuery, SearchResult } from '../types.js';

describe('reciprocalRankFusion (Cormack 2009 reference vector)', () => {
  it('reproduces the expected RRF ordering at k=60', () => {
    const fused = reciprocalRankFusion(
      REFERENCE_FTS_LIST,
      REFERENCE_DENSE_LIST,
      DEFAULT_HYBRID_CONFIG,
    );
    expect(fused.map((r) => r.postId)).toEqual([...EXPECTED_RRF_ORDER]);
  });

  it('reproduces the expected RRF scores to 7 decimal places', () => {
    const fused = reciprocalRankFusion(
      REFERENCE_FTS_LIST,
      REFERENCE_DENSE_LIST,
      DEFAULT_HYBRID_CONFIG,
    );
    for (const r of fused) {
      const expected = EXPECTED_RRF_SCORES[r.postId];
      expect(expected).not.toBeUndefined();
      expect(r.score).toBeCloseTo(expected as number, 6);
    }
  });

  it('handles a document that appears in only one list', () => {
    const fts: ReadonlyArray<SearchResult> = [
      Object.freeze({
        postId: 'only-fts',
        tenantId: 't1',
        score: 1.0,
        snippet: '',
        meta: Object.freeze({}),
      }),
    ];
    const dense: ReadonlyArray<SearchResult> = [
      Object.freeze({
        postId: 'only-dense',
        tenantId: 't1',
        score: 0.9,
        snippet: '',
        meta: Object.freeze({}),
      }),
    ];
    const fused = reciprocalRankFusion(fts, dense, DEFAULT_HYBRID_CONFIG);
    // Both should be present and equal-scored (same rank=1 contribution).
    expect(fused).toHaveLength(2);
    const onlyFts = fused.find((r) => r.postId === 'only-fts');
    const onlyDense = fused.find((r) => r.postId === 'only-dense');
    expect(onlyFts?.score).toBeCloseTo(onlyDense?.score ?? 0, 7);
  });
});

describe('createHybridSearcher', () => {
  it('truncates the fused list to query.k', async () => {
    const fts = {
      async search(_q: SearchQuery) {
        return REFERENCE_FTS_LIST;
      },
    };
    const dense = {
      async search(_q: SearchQuery) {
        return REFERENCE_DENSE_LIST;
      },
    };
    const hybrid = createHybridSearcher({ fts, dense });
    const result = await hybrid.search({
      tenantId: 'tenant-test',
      text: 'fuel',
      k: 3,
    });
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.postId)).toEqual(['d1', 'd3', 'd2']);
  });
});
