import { describe, expect, it } from 'vitest';
import { createItemItemCFRecommender } from '../algorithms/item-item-cf.js';
import type { Interaction, Item } from '../types.js';

describe('item-item CF recommender', () => {
  it('predicts unrated items via similar-item Pearson', () => {
    // Build a corpus where m0 and m1 co-occur strongly across u1, u2;
    // u0 rates m1 highly but has not seen m0 → CF should rank m0 first.
    const tenantId = 'tenant-a';
    const items: Item[] = ['m0', 'm1', 'm2', 'm3'].map((id) => ({ tenantId, id }));
    const now = 1_700_000_000_000;
    const interactions: Interaction[] = [
      // u0: rates m1 high, m2 low, m3 mid
      { tenantId, userId: 'u0', itemId: 'm1', rating: 5, timestamp: now },
      { tenantId, userId: 'u0', itemId: 'm2', rating: 1, timestamp: now },
      // u1 + u2 establish m0 ↔ m1 similarity (both rate them both high)
      { tenantId, userId: 'u1', itemId: 'm0', rating: 5, timestamp: now },
      { tenantId, userId: 'u1', itemId: 'm1', rating: 5, timestamp: now },
      { tenantId, userId: 'u1', itemId: 'm2', rating: 1, timestamp: now },
      { tenantId, userId: 'u2', itemId: 'm0', rating: 4, timestamp: now },
      { tenantId, userId: 'u2', itemId: 'm1', rating: 4, timestamp: now },
      { tenantId, userId: 'u2', itemId: 'm2', rating: 1, timestamp: now },
    ];
    const reco = createItemItemCFRecommender({ minOverlap: 2 });
    const result = reco.recommend({
      tenantId,
      target: 'buyer_mine',
      userId: 'u0',
      candidates: items,
      interactions,
      topK: 4,
    });
    // u0 has rated m1, m2 → excludeRated demotes them.
    // m0 is the only candidate with a strong similar-item signal → first.
    expect(result.topK[0]?.itemId).toBe('m0');
    expect(result.algorithm).toBe('item_item_cf');
  });

  it('returns score=0 with reason when no similar items exist', () => {
    const tenantId = 'tenant-a';
    const items: Item[] = ['m0', 'm1'].map((id) => ({ tenantId, id }));
    const reco = createItemItemCFRecommender();
    const result = reco.recommend({
      tenantId,
      target: 'buyer_mine',
      userId: 'u0',
      candidates: items,
      interactions: [
        // u0 rates m0 only; no other user has rated anything → no similarity signal.
        {
          tenantId,
          userId: 'u0',
          itemId: 'm0',
          rating: 5,
          timestamp: 1_700_000_000_000,
        },
      ],
      topK: 2,
    });
    // m1 has no similar items → score 0; m0 was rated → demoted.
    const m1 = result.topK.find((s) => s.itemId === 'm1');
    expect(m1?.score).toBe(0);
    expect(m1?.reason).toContain('no similar items');
  });
});
