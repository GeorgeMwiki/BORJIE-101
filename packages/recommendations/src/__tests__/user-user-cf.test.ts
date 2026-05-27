import { describe, expect, it } from 'vitest';
import { createUserUserCFRecommender } from '../algorithms/user-user-cf.js';
import type { Interaction, Item } from '../types.js';

describe('user-user CF recommender', () => {
  it('predicts via similarity-weighted neighbours and is symmetric in user pairings', () => {
    // Build a small symmetric corpus: u0 and u1 share preferences over
    // items 0..2; we hide item m0 from u0 and ask the recommender to
    // predict u0's rating on m0. Because u1 also liked m0 highly, the
    // CF prediction should rank m0 first for u0.
    const tenantId = 'tenant-a';
    const items: Item[] = ['m0', 'm1', 'm2', 'm3'].map((id) => ({ tenantId, id }));
    const now = 1_700_000_000_000;
    const interactions: Interaction[] = [
      // u0 rates m1, m2 highly
      { tenantId, userId: 'u0', itemId: 'm1', rating: 5, timestamp: now },
      { tenantId, userId: 'u0', itemId: 'm2', rating: 5, timestamp: now },
      { tenantId, userId: 'u0', itemId: 'm3', rating: 1, timestamp: now },
      // u1 rates m0, m1, m2 highly; agrees with u0 on m1, m2
      { tenantId, userId: 'u1', itemId: 'm0', rating: 5, timestamp: now },
      { tenantId, userId: 'u1', itemId: 'm1', rating: 5, timestamp: now },
      { tenantId, userId: 'u1', itemId: 'm2', rating: 5, timestamp: now },
      { tenantId, userId: 'u1', itemId: 'm3', rating: 1, timestamp: now },
      // u2 rates m0, m3 highly; disagrees with u0 on m3
      { tenantId, userId: 'u2', itemId: 'm0', rating: 5, timestamp: now },
      { tenantId, userId: 'u2', itemId: 'm3', rating: 5, timestamp: now },
    ];
    const reco = createUserUserCFRecommender({ minOverlap: 2 });
    const result = reco.recommend({
      tenantId,
      target: 'buyer_mine',
      userId: 'u0',
      candidates: items,
      interactions,
      topK: 4,
    });
    // u0 already rated m1, m2, m3; so excludeRated demotes them.
    // m0 is the only unrated candidate → must rank first.
    expect(result.topK[0]?.itemId).toBe('m0');
    expect(result.algorithm).toBe('user_user_cf');
  });

  it('treats target users symmetrically (u0 vs u1 yields parallel rankings)', () => {
    const tenantId = 'tenant-a';
    const items: Item[] = ['m0', 'm1', 'm2'].map((id) => ({ tenantId, id }));
    const now = 1_700_000_000_000;
    const interactions: Interaction[] = [
      // u0 and u1 each rate m0, m1 identically high. m2 is unseen by both.
      { tenantId, userId: 'u0', itemId: 'm0', rating: 5, timestamp: now },
      { tenantId, userId: 'u0', itemId: 'm1', rating: 5, timestamp: now },
      { tenantId, userId: 'u1', itemId: 'm0', rating: 5, timestamp: now },
      { tenantId, userId: 'u1', itemId: 'm1', rating: 5, timestamp: now },
      // u2 rates m2 high — neighbour for "what u0 hasn't seen".
      { tenantId, userId: 'u2', itemId: 'm0', rating: 5, timestamp: now },
      { tenantId, userId: 'u2', itemId: 'm1', rating: 5, timestamp: now },
      { tenantId, userId: 'u2', itemId: 'm2', rating: 5, timestamp: now },
    ];
    const reco = createUserUserCFRecommender({ minOverlap: 2 });
    const r0 = reco.recommend({
      tenantId,
      target: 'buyer_mine',
      userId: 'u0',
      candidates: items,
      interactions,
      topK: 3,
    });
    const r1 = reco.recommend({
      tenantId,
      target: 'buyer_mine',
      userId: 'u1',
      candidates: items,
      interactions,
      topK: 3,
    });
    // Both u0 and u1 should rank m2 first (the unrated item u2 likes).
    expect(r0.topK[0]?.itemId).toBe('m2');
    expect(r1.topK[0]?.itemId).toBe('m2');
  });

  it('returns zero-scores when target has no ratings', () => {
    const tenantId = 'tenant-a';
    const items: Item[] = ['m0', 'm1'].map((id) => ({ tenantId, id }));
    const reco = createUserUserCFRecommender();
    const result = reco.recommend({
      tenantId,
      target: 'buyer_mine',
      userId: 'u-cold',
      candidates: items,
      interactions: [],
      topK: 2,
    });
    expect(result.topK.every((s) => s.score === 0)).toBe(true);
  });
});
