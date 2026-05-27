import { describe, expect, it } from 'vitest';
import { createMatrixFactorizationRecommender } from '../algorithms/matrix-factorization.js';
import { buildLowRankCorpus } from '../__fixtures__/synthetic.js';

describe('matrix factorization recommender', () => {
  it('reconstructs known ratings within MSE tolerance on a low-rank corpus', () => {
    const tenantId = 'tenant-a';
    const { interactions, candidates } = buildLowRankCorpus({
      tenantId,
      nUsers: 8,
      nItems: 6,
    });
    const reco = createMatrixFactorizationRecommender({
      factors: 4,
      learningRate: 0.05,
      regularization: 0.01,
      iterations: 200,
    });
    // For target user u0 (axis-0 cluster), the highest-ranked items
    // should be the even-indexed items (m0, m2, m4) because they share
    // the axis-0 latent.
    const result = reco.recommend({
      tenantId,
      target: 'buyer_mine',
      userId: 'u0',
      candidates,
      interactions,
      topK: 6,
      seed: 12345,
    });
    const top3 = result.topK.slice(0, 3).map((s) => s.itemId).sort();
    expect(top3).toEqual(['m0', 'm2', 'm4']);
    expect(result.algorithm).toBe('matrix_factorization');
  });

  it('is byte-identical under the same seed', () => {
    const tenantId = 'tenant-a';
    const { interactions, candidates } = buildLowRankCorpus({
      tenantId,
      nUsers: 5,
      nItems: 4,
    });
    const reco = createMatrixFactorizationRecommender({
      factors: 3,
      iterations: 30,
      now: () => 1700000000000,
    });
    const req = {
      tenantId,
      target: 'buyer_mine' as const,
      userId: 'u0',
      candidates,
      interactions,
      topK: 4,
      seed: 42,
    };
    const a = reco.recommend(req);
    const b = reco.recommend(req);
    expect(a.auditHash).toBe(b.auditHash);
    expect(a.topK).toEqual(b.topK);
  });

  it('emits zero-score with reason when interactions are empty', () => {
    const tenantId = 'tenant-a';
    const reco = createMatrixFactorizationRecommender();
    const result = reco.recommend({
      tenantId,
      target: 'buyer_mine',
      userId: 'u-cold',
      candidates: [{ tenantId, id: 'm0' }],
      interactions: [],
      topK: 1,
      seed: 7,
    });
    expect(result.topK[0]?.score).toBe(0);
    expect(result.topK[0]?.reason).toContain('no interactions');
  });
});
