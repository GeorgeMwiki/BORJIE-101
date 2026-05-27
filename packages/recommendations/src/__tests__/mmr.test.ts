import { describe, expect, it } from 'vitest';
import { rerankMMR } from '../diversity/mmr.js';
import type { Item, ScoredItem } from '../types.js';

describe('MMR diversity reranker', () => {
  it('picks a diverse subset over a near-duplicate cluster', () => {
    const tenantId = 'tenant-a';
    // m0, m1, m2 are near-duplicates along the x-axis; m3 is orthogonal.
    const items: Item[] = [
      {
        tenantId,
        id: 'm0',
        embedding: { tenantId, id: 'm0', values: [1, 0] },
      },
      {
        tenantId,
        id: 'm1',
        embedding: { tenantId, id: 'm1', values: [0.99, 0.01] },
      },
      {
        tenantId,
        id: 'm2',
        embedding: { tenantId, id: 'm2', values: [0.98, 0.02] },
      },
      {
        tenantId,
        id: 'm3',
        embedding: { tenantId, id: 'm3', values: [0, 1] },
      },
    ];
    // Scored top-relevance order: m0, m1, m2, m3.
    const scored: ScoredItem[] = [
      { itemId: 'm0', score: 1.0 },
      { itemId: 'm1', score: 0.95 },
      { itemId: 'm2', score: 0.9 },
      { itemId: 'm3', score: 0.5 },
    ];
    // λ=0.5 — equal-weight relevance vs. diversity. After picking m0,
    // m3 (orthogonal, similarity 0) outscores m1 (similarity ≈ 1).
    const result = rerankMMR(scored, items, { lambda: 0.5, topK: 2 });
    expect(result.map((r) => r.itemId)).toEqual(['m0', 'm3']);
  });

  it('λ=1.0 collapses to pure relevance order', () => {
    const tenantId = 'tenant-a';
    const items: Item[] = ['m0', 'm1', 'm2'].map((id) => ({
      tenantId,
      id,
      embedding: { tenantId, id, values: [1, 0] },
    }));
    const scored: ScoredItem[] = [
      { itemId: 'm0', score: 0.9 },
      { itemId: 'm1', score: 0.8 },
      { itemId: 'm2', score: 0.7 },
    ];
    const result = rerankMMR(scored, items, { lambda: 1.0, topK: 3 });
    expect(result.map((r) => r.itemId)).toEqual(['m0', 'm1', 'm2']);
  });

  it('throws on lambda outside [0, 1]', () => {
    expect(() => rerankMMR([], [], { lambda: -0.1, topK: 1 })).toThrow(
      /lambda must be in \[0,1\]/,
    );
    expect(() => rerankMMR([], [], { lambda: 1.5, topK: 1 })).toThrow();
  });

  it('uses an injected feature-grounded similarity when provided', () => {
    const tenantId = 'tenant-a';
    const items: Item[] = [
      { tenantId, id: 'm0', features: { jurisdiction: 'TZ-DSM' } },
      { tenantId, id: 'm1', features: { jurisdiction: 'TZ-DSM' } },
      { tenantId, id: 'm2', features: { jurisdiction: 'TZ-MWA' } },
    ];
    const scored: ScoredItem[] = [
      { itemId: 'm0', score: 1.0 },
      { itemId: 'm1', score: 0.95 },
      { itemId: 'm2', score: 0.7 },
    ];
    const result = rerankMMR(scored, items, {
      lambda: 0.5,
      topK: 2,
      similarity: (a, b) =>
        a.features?.jurisdiction === b.features?.jurisdiction ? 1 : 0,
    });
    // After picking m0 (TZ-DSM), m2 (TZ-MWA) is preferred to m1 (TZ-DSM)
    // even though m1 has higher base score.
    expect(result.map((r) => r.itemId)).toEqual(['m0', 'm2']);
  });
});
