/**
 * Embeddings tests — deterministic vectors + hybrid search.
 */
import { describe, expect, it } from 'vitest';
import {
  createMockGraphEmbedder,
  cosineSimilarity,
  findRelevant,
} from '../embeddings/index.js';
import { createInMemoryStore } from '../store/in-memory.js';
import { TENANT, smallEstateFixture } from './fixtures.js';

describe('createMockGraphEmbedder', () => {
  it('produces vectors of the configured dimension', async () => {
    const embedder = createMockGraphEmbedder({ dimension: 32 });
    const fx = smallEstateFixture();
    const ev = await embedder.embedNode({
      node: fx.nodes[0]!,
      neighbors: [],
    });
    expect(ev.dimension).toBe(32);
    expect(ev.vector.length).toBe(32);
  });

  it('is deterministic — same input always yields same vector', async () => {
    const embedder = createMockGraphEmbedder({ dimension: 16 });
    const fx = smallEstateFixture();
    const a = await embedder.embedNode({ node: fx.nodes[0]!, neighbors: [] });
    const b = await embedder.embedNode({ node: fx.nodes[0]!, neighbors: [] });
    expect(a.vector).toEqual(b.vector);
  });

  it('produces L2-normalised vectors', async () => {
    const embedder = createMockGraphEmbedder({ dimension: 16 });
    const fx = smallEstateFixture();
    const ev = await embedder.embedNode({ node: fx.nodes[0]!, neighbors: [] });
    let sum = 0;
    for (const x of ev.vector) sum += x * x;
    expect(Math.sqrt(sum)).toBeCloseTo(1, 2);
  });

  it('neighbours change the output vector', async () => {
    const embedder = createMockGraphEmbedder({ dimension: 16 });
    const fx = smallEstateFixture();
    const alone = await embedder.embedNode({ node: fx.nodes[0]!, neighbors: [] });
    const withNeigh = await embedder.embedNode({
      node: fx.nodes[0]!,
      neighbors: [fx.nodes[1]!, fx.nodes[2]!],
    });
    expect(alone.vector).not.toEqual(withNeigh.vector);
  });

  it('rejects invalid dimensions', () => {
    expect(() => createMockGraphEmbedder({ dimension: 0 })).toThrow();
    expect(() => createMockGraphEmbedder({ dimension: -1 })).toThrow();
    expect(() => createMockGraphEmbedder({ dimension: 5000 })).toThrow();
  });

  it('embedSubgraph aggregates node embeddings', async () => {
    const embedder = createMockGraphEmbedder({ dimension: 16 });
    const fx = smallEstateFixture();
    const ev = await embedder.embedSubgraph({
      nodes: fx.nodes.slice(0, 3),
      edges: [],
      tenantId: TENANT,
    });
    expect(ev.vector.length).toBe(16);
    expect(ev.nodeId).toContain('subgraph::');
  });

  it('embedSubgraph throws on empty subgraph', async () => {
    const embedder = createMockGraphEmbedder({ dimension: 16 });
    await expect(
      embedder.embedSubgraph({ nodes: [], edges: [], tenantId: TENANT }),
    ).rejects.toThrow(/empty/);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1])).toThrow(/dimension/);
  });
});

describe('findRelevant — hybrid retrieval', () => {
  it('returns ranked subgraphs ordered by score', async () => {
    const fx = smallEstateFixture();
    const store = createInMemoryStore({ seedNodes: fx.nodes, seedEdges: fx.edges });
    const embedder = createMockGraphEmbedder({ dimension: 32 });
    const ranked = await findRelevant({
      question: 'tenants in Karen who are in arrears',
      tenantId: TENANT,
      store,
      embedder,
      topK: 3,
      maxHops: 1,
    });
    expect(ranked.length).toBe(3);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
    // Each ranked subgraph contains the seed node
    for (const r of ranked) {
      expect(r.subgraph.nodes.some((n) => n.id === r.seedNodeId)).toBe(true);
    }
  });

  it('respects the seedClasses filter', async () => {
    const fx = smallEstateFixture();
    const store = createInMemoryStore({ seedNodes: fx.nodes, seedEdges: fx.edges });
    const embedder = createMockGraphEmbedder({ dimension: 32 });
    const ranked = await findRelevant({
      question: 'units',
      tenantId: TENANT,
      store,
      embedder,
      topK: 5,
      maxHops: 1,
      seedClasses: ['Unit'],
    });
    expect(ranked.length).toBeGreaterThan(0);
    for (const r of ranked) {
      const seed = r.subgraph.nodes.find((n) => n.id === r.seedNodeId);
      expect(seed?.class).toBe('Unit');
    }
  });

  it('errors on missing tenantId', async () => {
    const store = createInMemoryStore();
    const embedder = createMockGraphEmbedder({ dimension: 16 });
    await expect(
      findRelevant({ question: 'x', tenantId: '', store, embedder }),
    ).rejects.toThrow(/tenantId/);
  });

  it('errors on empty question', async () => {
    const store = createInMemoryStore();
    const embedder = createMockGraphEmbedder({ dimension: 16 });
    await expect(
      findRelevant({ question: '   ', tenantId: TENANT, store, embedder }),
    ).rejects.toThrow(/question/);
  });
});
