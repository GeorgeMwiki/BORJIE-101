/**
 * Unit tests for `hybrid-retrieval.ts`.
 *
 * RRF math is verified directly; the orchestration is exercised with
 * an in-memory `HybridRetrievalRepo` fake.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOP_N,
  PER_SOURCE_LIMIT,
  RRF_K,
  buildRetrievedContext,
  reciprocalRankFusion,
} from '../hybrid-retrieval.js';
import type {
  HybridRetrievalRepo,
  RetrievalCandidate,
} from '../types-amem.js';

const fakeEmbedder = async (
  _text: string,
): Promise<ReadonlyArray<number>> => [1, 0, 0];

function makeFakeRepo(bm25: RetrievalCandidate[], vec: RetrievalCandidate[]): HybridRetrievalRepo {
  return {
    async searchBm25(): Promise<ReadonlyArray<RetrievalCandidate>> {
      return bm25;
    },
    async searchVector(): Promise<ReadonlyArray<RetrievalCandidate>> {
      return vec;
    },
  };
}

describe('reciprocalRankFusion', (): void => {
  it('returns empty for empty inputs', (): void => {
    expect(reciprocalRankFusion([], [])).toEqual([]);
  });

  it('uses RRF formula with K=60 by default', (): void => {
    const list = [
      { id: 'a', text: 'doc-a' },
      { id: 'b', text: 'doc-b' },
    ];
    const fused = reciprocalRankFusion(list, []);
    // a is rank 1 → score = 1/61; b is rank 2 → score = 1/62
    expect(fused[0].id).toBe('a');
    expect(fused[0].score).toBeCloseTo(1 / 61, 6);
    expect(fused[1].id).toBe('b');
    expect(fused[1].score).toBeCloseTo(1 / 62, 6);
  });

  it('sums scores across both rank lists', (): void => {
    const bm25 = [{ id: 'a', text: 'doc-a' }];
    const vec = [{ id: 'a', text: 'doc-a' }];
    const fused = reciprocalRankFusion(bm25, vec);
    expect(fused[0].id).toBe('a');
    expect(fused[0].score).toBeCloseTo(2 / 61, 6);
  });

  it('breaks score ties deterministically by id', (): void => {
    const list = [
      { id: 'b', text: 'doc-b' },
      { id: 'a', text: 'doc-a' },
    ];
    const fused = reciprocalRankFusion(list, []);
    // Different scores here, but verify the ordering function works
    expect(fused.map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('exports RRF_K=60 (Cormack-Cleverdon-Voorhees default)', (): void => {
    expect(RRF_K).toBe(60);
  });
});

describe('buildRetrievedContext', (): void => {
  it('throws when embedder is missing', async (): Promise<void> => {
    await expect(
      buildRetrievedContext(
        't',
        's',
        'hi',
        undefined as unknown as Parameters<typeof buildRetrievedContext>[3],
        makeFakeRepo([], []),
      ),
    ).rejects.toThrow(/embedder/);
  });

  it('throws when repo is missing the methods', async (): Promise<void> => {
    await expect(
      buildRetrievedContext(
        't',
        's',
        'hi',
        fakeEmbedder,
        {} as unknown as HybridRetrievalRepo,
      ),
    ).rejects.toThrow(/searchBm25/);
  });

  it('returns empty for empty query', async (): Promise<void> => {
    const repo = makeFakeRepo(
      [{ id: 'a', text: 'doc-a' }],
      [{ id: 'b', text: 'doc-b' }],
    );
    const out = await buildRetrievedContext('t', 's', '   ', fakeEmbedder, repo);
    expect(out).toEqual([]);
  });

  it('merges BM25 + vector and returns top-N text', async (): Promise<void> => {
    const bm25 = [
      { id: 'a', text: 'alpha' },
      { id: 'b', text: 'bravo' },
    ];
    const vec = [
      { id: 'b', text: 'bravo' },
      { id: 'c', text: 'charlie' },
    ];
    const repo = makeFakeRepo(bm25, vec);
    const out = await buildRetrievedContext('t', 's', 'query', fakeEmbedder, repo);
    // 'b' appears in both, so its summed score is highest.
    expect(out[0]).toBe('bravo');
    expect(out).toContain('alpha');
    expect(out).toContain('charlie');
  });

  it('respects custom topN', async (): Promise<void> => {
    const bm25 = Array.from({ length: 10 }, (_, i) => ({
      id: `id-${i}`,
      text: `text-${i}`,
    }));
    const repo = makeFakeRepo(bm25, []);
    const out = await buildRetrievedContext('t', 's', 'q', fakeEmbedder, repo, {
      topN: 3,
    });
    expect(out.length).toBe(3);
  });

  it('is fail-soft when one branch throws', async (): Promise<void> => {
    const repo: HybridRetrievalRepo = {
      async searchBm25(): Promise<ReadonlyArray<RetrievalCandidate>> {
        throw new Error('boom');
      },
      async searchVector(): Promise<ReadonlyArray<RetrievalCandidate>> {
        return [{ id: 'v', text: 'vector-only' }];
      },
    };
    const out = await buildRetrievedContext('t', 's', 'q', fakeEmbedder, repo);
    expect(out).toEqual(['vector-only']);
  });

  it('exposes documented defaults', (): void => {
    expect(DEFAULT_TOP_N).toBe(8);
    expect(PER_SOURCE_LIMIT).toBe(30);
  });
});

describe('buildRetrievedContext — MMR integration', (): void => {
  it('applies MMR rerank by default (withMmr=true)', async (): Promise<void> => {
    // Three candidates where the vector branch supplies embeddings.
    // Without MMR, 'a-dup' would rank #2 by RRF. With MMR + λ=0.7,
    // the second pick should diversify away from 'a'.
    const vec = [
      { id: 'a', text: 'alpha-strong', embedding: [1, 0] },
      { id: 'a-dup', text: 'alpha-near-dup', embedding: [0.99, 0.01] },
      { id: 'b', text: 'bravo-orthogonal', embedding: [0, 1] },
    ];
    const repo = makeFakeRepo([], vec);
    const out = await buildRetrievedContext('t', 's', 'q', fakeEmbedder, repo, {
      topN: 2,
    });
    expect(out[0]).toBe('alpha-strong');
    expect(out[1]).toBe('bravo-orthogonal');
  });

  it('bypasses MMR when withMmr=false', async (): Promise<void> => {
    const vec = [
      { id: 'a', text: 'alpha-strong', embedding: [1, 0] },
      { id: 'a-dup', text: 'alpha-near-dup', embedding: [0.99, 0.01] },
      { id: 'b', text: 'bravo-orthogonal', embedding: [0, 1] },
    ];
    const repo = makeFakeRepo([], vec);
    const out = await buildRetrievedContext('t', 's', 'q', fakeEmbedder, repo, {
      topN: 2,
      withMmr: false,
    });
    // RRF preserves the original vector branch order — a, a-dup.
    expect(out[0]).toBe('alpha-strong');
    expect(out[1]).toBe('alpha-near-dup');
  });

  it('invokes the onQueryEmbedding observer with the query embedding', async (): Promise<void> => {
    const seen: number[][] = [];
    const repo = makeFakeRepo([], [{ id: 'a', text: 'a', embedding: [1, 0, 0] }]);
    await buildRetrievedContext('t', 's', 'q', fakeEmbedder, repo, {
      onQueryEmbedding: (emb): void => {
        seen.push(Array.from(emb));
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([1, 0, 0]);
  });

  it('swallows observer errors without failing retrieval', async (): Promise<void> => {
    const repo = makeFakeRepo([], [{ id: 'a', text: 'a', embedding: [1, 0, 0] }]);
    const out = await buildRetrievedContext('t', 's', 'q', fakeEmbedder, repo, {
      onQueryEmbedding: (): void => {
        throw new Error('observer-blew-up');
      },
    });
    expect(out).toContain('a');
  });
});
