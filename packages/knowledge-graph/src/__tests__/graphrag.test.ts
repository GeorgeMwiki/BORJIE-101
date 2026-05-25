/**
 * GraphRAG tests — expandFromSeed, community detection, answerWithKG.
 */
import { describe, expect, it } from 'vitest';
import {
  expandFromSeed,
  detectCommunities,
  summarizeCommunity,
  answerWithKG,
} from '../graphrag/index.js';
import { createInMemoryStore } from '../store/in-memory.js';
import { createMockGraphEmbedder } from '../embeddings/index.js';
import type { KGBrainPort } from '../types.js';
import { TENANT, smallEstateFixture, fixtureSubgraph } from './fixtures.js';

function makeMockBrain(): KGBrainPort {
  return {
    async summarize({ prompt: _prompt, facts }) {
      return `[SUMMARY of ${facts.length} facts] ` + facts.slice(0, 3).join(' | ');
    },
    async answer({ question, context }) {
      return `ANSWER[${question}] using ${context.length} community summaries: ${context.slice(0, 1).join('')}`;
    },
  };
}

describe('expandFromSeed', () => {
  it('expands a single seed 1 hop', async () => {
    const fx = smallEstateFixture();
    const store = createInMemoryStore({ seedNodes: fx.nodes, seedEdges: fx.edges });
    const sub = await expandFromSeed({
      tenantId: TENANT,
      seedNodeIds: ['p1'],
      store,
      depth: 1,
    });
    const ids = new Set(sub.nodes.map((n) => n.id));
    expect(ids.has('p1')).toBe(true);
    expect(ids.has('u1')).toBe(true);
    expect(ids.has('mgr1')).toBe(true);
    expect(ids.has('parcel1')).toBe(true);
    // Tenant t1 sits 2 hops away
    expect(ids.has('t1')).toBe(false);
  });

  it('expands to 2 hops', async () => {
    const fx = smallEstateFixture();
    const store = createInMemoryStore({ seedNodes: fx.nodes, seedEdges: fx.edges });
    const sub = await expandFromSeed({
      tenantId: TENANT,
      seedNodeIds: ['p1'],
      store,
      depth: 2,
    });
    const ids = new Set(sub.nodes.map((n) => n.id));
    expect(ids.has('t1')).toBe(true);
    expect(ids.has('t2')).toBe(true);
    expect(ids.has('d1')).toBe(true); // p1 -> parcel1 -> d1
  });

  it('honours edge-label filter', async () => {
    const fx = smallEstateFixture();
    const store = createInMemoryStore({ seedNodes: fx.nodes, seedEdges: fx.edges });
    const sub = await expandFromSeed({
      tenantId: TENANT,
      seedNodeIds: ['p1'],
      store,
      depth: 2,
      edgeFilters: ['hasUnit'],
    });
    const labels = new Set(sub.edges.map((e) => e.label));
    expect(labels.size).toBe(1);
    expect(labels.has('hasUnit')).toBe(true);
  });

  it('returns empty subgraph for empty seeds', async () => {
    const store = createInMemoryStore();
    const sub = await expandFromSeed({
      tenantId: TENANT,
      seedNodeIds: [],
      store,
      depth: 2,
    });
    expect(sub.nodes.length).toBe(0);
  });

  it('errors on missing tenantId', async () => {
    const store = createInMemoryStore();
    await expect(
      expandFromSeed({ tenantId: '', seedNodeIds: ['p1'], store }),
    ).rejects.toThrow(/tenantId/);
  });
});

describe('detectCommunities', () => {
  it('groups connected nodes into a single community', () => {
    const communities = detectCommunities(fixtureSubgraph());
    // All nodes in the fixture form one big connected component
    expect(communities.length).toBe(1);
    expect(communities[0]!.nodeIds.length).toBe(13);
  });

  it('separates disconnected sub-components', () => {
    const fx = smallEstateFixture();
    // Build a subgraph with two disconnected halves
    const halfA = fx.nodes.slice(0, 3);
    const halfB = fx.nodes.slice(10);
    const noEdges: ReadonlyArray<typeof fx.edges[number]> = [];
    const communities = detectCommunities({
      nodes: [...halfA, ...halfB],
      edges: noEdges,
      tenantId: TENANT,
    });
    // With no edges, each node is its own community
    expect(communities.length).toBe(halfA.length + halfB.length);
  });

  it('returns empty array for empty subgraph', () => {
    const communities = detectCommunities({ nodes: [], edges: [], tenantId: TENANT });
    expect(communities).toEqual([]);
  });
});

describe('summarizeCommunity', () => {
  it('produces a summary with topClasses + communityId', async () => {
    const sub = fixtureSubgraph();
    const summary = await summarizeCommunity({ subgraph: sub, brain: makeMockBrain() });
    expect(summary.communityId.startsWith('community::')).toBe(true);
    expect(summary.nodeIds.length).toBe(sub.nodes.length);
    expect(summary.summary).toContain('SUMMARY');
    expect(summary.topClasses.length).toBeGreaterThan(0);
  });

  it('throws on empty subgraph', async () => {
    await expect(
      summarizeCommunity({
        subgraph: { nodes: [], edges: [], tenantId: TENANT },
        brain: makeMockBrain(),
      }),
    ).rejects.toThrow(/empty/);
  });
});

describe('answerWithKG — end-to-end with mock brain', () => {
  it('produces answer + citationPaths + communities', async () => {
    const fx = smallEstateFixture();
    const store = createInMemoryStore({ seedNodes: fx.nodes, seedEdges: fx.edges });
    const embedder = createMockGraphEmbedder({ dimension: 32 });
    const brain = makeMockBrain();
    const out = await answerWithKG({
      question: 'which tenants are renting units at Karen Heights?',
      tenantId: TENANT,
      store,
      embedder,
      brain,
      topK: 3,
      maxHops: 2,
    });
    expect(out.question).toContain('which tenants');
    expect(out.answer).toContain('ANSWER');
    expect(out.citationPaths.length).toBeGreaterThan(0);
    expect(out.communities.length).toBeGreaterThan(0);
    // Each citation path has facts referencing real node IDs
    for (const cp of out.citationPaths) {
      expect(cp.facts.length).toBeGreaterThan(0);
    }
  });

  it('returns a graceful empty-answer when the tenant has no facts', async () => {
    const store = createInMemoryStore();
    const embedder = createMockGraphEmbedder({ dimension: 16 });
    const brain = makeMockBrain();
    const out = await answerWithKG({
      question: 'anything?',
      tenantId: TENANT,
      store,
      embedder,
      brain,
    });
    expect(out.answer).toContain('No knowledge-graph facts');
  });

  it('errors on missing tenantId', async () => {
    const store = createInMemoryStore();
    const embedder = createMockGraphEmbedder({ dimension: 16 });
    const brain = makeMockBrain();
    await expect(
      answerWithKG({ question: 'x', tenantId: '', store, embedder, brain }),
    ).rejects.toThrow(/tenantId/);
  });

  it('errors on empty question', async () => {
    const store = createInMemoryStore();
    const embedder = createMockGraphEmbedder({ dimension: 16 });
    const brain = makeMockBrain();
    await expect(
      answerWithKG({ question: '', tenantId: TENANT, store, embedder, brain }),
    ).rejects.toThrow(/question/);
  });
});
