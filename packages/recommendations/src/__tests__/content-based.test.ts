import { describe, expect, it } from 'vitest';
import { createContentBasedRecommender } from '../algorithms/content-based.js';
import { buildClusterCorpus, buildRequest } from '../__fixtures__/synthetic.js';
import type { Item } from '../types.js';

describe('content-based recommender', () => {
  it('ranks items by cosine similarity to the user vector', () => {
    const corpus = buildClusterCorpus();
    const reco = createContentBasedRecommender({ now: () => 1700000000000 });
    // u0 liked m0, m1, m2 (all on the x-axis). User vector ≈ (0.9, 0.1).
    // m0 is most similar → first.
    const result = reco.recommend(
      buildRequest({ corpus, userId: 'u0', topK: 5 }),
    );
    expect(result.algorithm).toBe('content_based');
    // m0/m1/m2 should outrank m3/m4 because they are the user's cluster.
    const top3 = result.topK.slice(0, 3).map((s) => s.itemId).sort();
    expect(top3).toEqual(['m0', 'm1', 'm2']);
    // Scores must be in non-increasing order.
    for (let i = 1; i < result.topK.length; i += 1) {
      expect(result.topK[i]!.score).toBeLessThanOrEqual(
        result.topK[i - 1]!.score,
      );
    }
  });

  it('falls back to user.embedding when no positive interactions exist', () => {
    const corpus = buildClusterCorpus();
    const reco = createContentBasedRecommender();
    // u4 has no interactions; supply a y-aligned user embedding so we
    // expect m3, m4 to outrank the x-axis cluster.
    const baseReq = buildRequest({ corpus, userId: 'u4', topK: 5 });
    const result = reco.recommend({
      ...baseReq,
      user: {
        tenantId: corpus.tenantId,
        id: 'u4',
        embedding: {
          tenantId: corpus.tenantId,
          id: 'u4',
          values: [0.0, 1.0],
        },
      },
    });
    const top2 = result.topK.slice(0, 2).map((s) => s.itemId).sort();
    expect(top2).toEqual(['m3', 'm4']);
  });

  it('throws on cross-tenant user embedding', () => {
    const corpus = buildClusterCorpus('tenant-a');
    const reco = createContentBasedRecommender();
    const baseReq = buildRequest({ corpus, userId: 'u4' });
    const tampered = {
      ...baseReq,
      user: {
        tenantId: 'tenant-a' as const,
        id: 'u4',
        embedding: {
          tenantId: 'tenant-b',
          id: 'u4',
          values: [1, 0],
        },
      },
    } as const;
    expect(() => reco.recommend(tampered)).toThrow(/embedding tenant tenant-b/);
  });

  it('returns zero-score with reason when item has no embedding', () => {
    const corpus = buildClusterCorpus();
    const reco = createContentBasedRecommender();
    const baseReq = buildRequest({ corpus, userId: 'u0', topK: 5 });
    const items: Item[] = [
      ...baseReq.candidates,
      { tenantId: corpus.tenantId, id: 'm-noemb' },
    ];
    const result = reco.recommend({ ...baseReq, candidates: items, topK: 6 });
    const noEmb = result.topK.find((s) => s.itemId === 'm-noemb');
    expect(noEmb?.score).toBe(0);
    expect(noEmb?.reason).toContain('no item embedding');
  });
});
