/**
 * Headline `createKnowledgeGraph` factory tests.
 */
import { describe, expect, it } from 'vitest';
import {
  createKnowledgeGraph,
  realEstateOntology,
  type KGBrainPort,
} from '../index.js';
import { TENANT, smallEstateFixture } from './fixtures.js';

describe('createKnowledgeGraph', () => {
  it('returns a usable KG with all defaults', async () => {
    const kg = createKnowledgeGraph({});
    expect(kg.store).toBeDefined();
    expect(kg.embedder).toBeDefined();
    expect(kg.ontology).toBe(realEstateOntology);
    expect(kg.brain).not.toBeNull();
  });

  it('upserts a node end-to-end', async () => {
    const kg = createKnowledgeGraph({});
    await kg.upsertNode({
      id: 'p1',
      class: 'Property',
      tenantId: TENANT,
      properties: { name: 'Karen Heights' },
    });
    const got = await kg.store.getNode({ tenantId: TENANT, id: 'p1' });
    expect(got?.id).toBe('p1');
  });

  it('expand() returns a subgraph', async () => {
    const fx = smallEstateFixture();
    const kg = createKnowledgeGraph({});
    for (const n of fx.nodes) await kg.store.upsertNode(n);
    for (const e of fx.edges) await kg.store.upsertEdge(e);
    const sub = await kg.expand({
      seedNodeIds: ['p1'],
      tenantId: TENANT,
      depth: 1,
    });
    expect(sub.nodes.some((n) => n.id === 'p1')).toBe(true);
  });

  it('ask() runs the full GraphRAG pipeline', async () => {
    const fx = smallEstateFixture();
    const brain: KGBrainPort = {
      async summarize({ facts }) {
        return `summary-of-${facts.length}`;
      },
      async answer({ question }) {
        return `re: ${question}`;
      },
    };
    const kg = createKnowledgeGraph({ brain });
    for (const n of fx.nodes) await kg.store.upsertNode(n);
    for (const e of fx.edges) await kg.store.upsertEdge(e);
    const out = await kg.ask({
      question: 'tenants with arrears',
      tenantId: TENANT,
    });
    expect(out.answer.startsWith('re:')).toBe(true);
    expect(out.communities.length).toBeGreaterThan(0);
  });
});
