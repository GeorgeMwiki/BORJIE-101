import { describe, expect, it } from 'vitest';
import { hybridRetrieve } from '../retrieval.js';
import type {
  Bm25RetrieverPort,
  EmbedderPort,
  HybridRetrieverDeps,
  MmrRerankerPort,
  RetrievalHit,
  VectorRetrieverPort,
} from '../retrieval.js';
import type { GraphTraversalPort } from '@borjie/org-graph';

function hit(id: string, source: RetrievalHit['source']): RetrievalHit {
  return { id, kind: 'entity', snippet: `hit ${id}`, score: 0.5, source };
}

function makeDeps(overrides: Partial<HybridRetrieverDeps> = {}): HybridRetrieverDeps {
  const bm25: Bm25RetrieverPort = {
    async search() {
      return [hit('a', 'bm25'), hit('b', 'bm25')];
    },
  };
  const vector: VectorRetrieverPort = {
    async search() {
      return [hit('b', 'vector'), hit('c', 'vector')];
    },
  };
  const embedder: EmbedderPort = {
    async embed() {
      return [0.1, 0.2, 0.3];
    },
  };
  const mmr: MmrRerankerPort = {
    async rerank({ hits, k }) {
      return hits.slice(0, k);
    },
  };
  const graph: GraphTraversalPort = {
    async findAncestors() {
      return [];
    },
    async findDescendants() {
      return [];
    },
    async findShortestPath() {
      return null;
    },
    async findAllReachable() {
      return [];
    },
  };
  return { bm25, vector, embedder, mmr, graph, ...overrides };
}

describe('hybridRetrieve', () => {
  it('merges bm25 + vector hits and dedups by id', async () => {
    const out = await hybridRetrieve(makeDeps(), {
      tenantId: 't',
      query: 'q',
      k: 10,
    });
    // a, b, c distinct
    expect(out.map((h) => h.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('expands via graph when anchors provided', async () => {
    const out = await hybridRetrieve(
      makeDeps({
        graph: {
          async findAllReachable() {
            return [
              { entityId: 'd', depth: 1, edgeType: 'managed_by', path: ['e1'] },
              { entityId: 'e', depth: 2, edgeType: 'managed_by', path: ['e1', 'e2'] },
            ];
          },
          async findAncestors() {
            return [];
          },
          async findDescendants() {
            return [];
          },
          async findShortestPath() {
            return null;
          },
        },
      }),
      {
        tenantId: 't',
        query: 'q',
        anchorEntityIds: ['a'],
        k: 10,
      },
    );
    expect(out.map((h) => h.id)).toContain('d');
    expect(out.map((h) => h.id)).toContain('e');
  });

  it('handles bm25 failure gracefully', async () => {
    const out = await hybridRetrieve(
      makeDeps({
        bm25: {
          async search() {
            throw new Error('bm25 down');
          },
        },
      }),
      { tenantId: 't', query: 'q' },
    );
    // Should still surface vector hits.
    expect(out.length).toBeGreaterThan(0);
  });

  it('handles embedder failure by falling back to BM25 only', async () => {
    const out = await hybridRetrieve(
      makeDeps({
        embedder: {
          async embed() {
            throw new Error('embed down');
          },
        },
      }),
      { tenantId: 't', query: 'q' },
    );
    expect(out.map((h) => h.id)).toContain('a');
  });

  it('falls back to merged hits when MMR fails', async () => {
    const out = await hybridRetrieve(
      makeDeps({
        mmr: {
          async rerank() {
            throw new Error('mmr down');
          },
        },
      }),
      { tenantId: 't', query: 'q', k: 5 },
    );
    expect(out.length).toBeGreaterThan(0);
  });
});
