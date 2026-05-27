import { describe, expect, it } from 'vitest';
import { createPopularityRecommender } from '../algorithms/popularity.js';
import { buildClusterCorpus, buildRequest } from '../__fixtures__/synthetic.js';

describe('popularity recommender', () => {
  it('returns the most-interacted item first', () => {
    const corpus = buildClusterCorpus();
    const reco = createPopularityRecommender({ now: () => 1700000000000 });
    const result = reco.recommend(
      buildRequest({ corpus, userId: 'u4', topK: 3 }),
    );
    // m0 has 4 interactions in the cluster corpus (u0, u1, u2, u3);
    // m1, m2, m3, m4 have 2 each.
    expect(result.topK[0]?.itemId).toBe('m0');
    expect(result.algorithm).toBe('popularity');
    expect(result.topK.length).toBe(3);
    expect(result.auditHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('breaks ties deterministically by itemId ascending', () => {
    const corpus = buildClusterCorpus();
    const reco = createPopularityRecommender();
    const result = reco.recommend(
      buildRequest({ corpus, userId: 'u4', topK: 5 }),
    );
    // After m0, the next four items (m1..m4) all have score 2 → ties.
    // Sorted ascending by itemId gives m1, m2, m3, m4.
    expect(result.topK.map((s) => s.itemId)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
  });

  it('rejects cross-tenant candidates', () => {
    const corpus = buildClusterCorpus('tenant-a');
    const reco = createPopularityRecommender();
    const crossTenantReq = buildRequest({ corpus, userId: 'u0' });
    const tampered = {
      ...crossTenantReq,
      candidates: [
        { ...crossTenantReq.candidates[0]!, tenantId: 'tenant-b' },
        ...crossTenantReq.candidates.slice(1),
      ],
    };
    expect(() => reco.recommend(tampered)).toThrow(/tenant tenant-b/);
  });
});
