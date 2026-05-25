/**
 * Store tests — in-memory adapter round-trip + tenant isolation.
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryStore } from '../store/in-memory.js';
import { OTHER_TENANT, TENANT, makeEdge, makeNode, smallEstateFixture } from './fixtures.js';
import {
  createKuzuAdapter,
  createNeo4jAdapter,
} from '../store/adapters.js';

describe('createInMemoryStore — round-trips', () => {
  it('upserts and reads back a node', async () => {
    const store = createInMemoryStore();
    await store.upsertNode(makeNode({ id: 'p1', class: 'Property', properties: { name: 'X' } }));
    const got = await store.getNode({ tenantId: TENANT, id: 'p1' });
    expect(got?.id).toBe('p1');
    expect(got?.properties.name).toBe('X');
  });

  it('seeds nodes and edges via constructor options', async () => {
    const fx = smallEstateFixture();
    const store = createInMemoryStore({ seedNodes: fx.nodes, seedEdges: fx.edges });
    const all = await store.allNodes(TENANT);
    expect(all.length).toBe(fx.nodes.length);
    const allEdges = await store.allEdges(TENANT);
    expect(allEdges.length).toBe(fx.edges.length);
  });

  it('rejects an edge whose endpoint is missing', async () => {
    const store = createInMemoryStore();
    await store.upsertNode(makeNode({ id: 'p1', class: 'Property' }));
    await expect(
      store.upsertEdge(makeEdge({ id: 'e1', fromId: 'p1', toId: 'missing', label: 'hasUnit' })),
    ).rejects.toThrow(/toId/);
  });

  it('rejects empty tenantId', async () => {
    const store = createInMemoryStore();
    await expect(
      store.upsertNode({ id: 'p1', class: 'Property', tenantId: '', properties: {} }),
    ).rejects.toThrow(/tenantId/);
  });
});

describe('createInMemoryStore — tenant isolation', () => {
  it('does not return another tenant\'s nodes', async () => {
    const store = createInMemoryStore();
    await store.upsertNode(makeNode({ id: 'p1', class: 'Property' }));
    await store.upsertNode({
      id: 'p2',
      class: 'Property',
      tenantId: OTHER_TENANT,
      properties: {},
    });
    const acmeNodes = await store.allNodes(TENANT);
    const otherNodes = await store.allNodes(OTHER_TENANT);
    expect(acmeNodes.map((n) => n.id)).toEqual(['p1']);
    expect(otherNodes.map((n) => n.id)).toEqual(['p2']);
  });

  it('rejects cross-tenant edge creation', async () => {
    const store = createInMemoryStore();
    await store.upsertNode(makeNode({ id: 'p1', class: 'Property' }));
    await store.upsertNode({
      id: 'u1',
      class: 'Unit',
      tenantId: OTHER_TENANT,
      properties: {},
    });
    // Edge in TENANT scope referencing p1 (tenant=TENANT) and u1 (tenant=OTHER) — u1 not visible
    await expect(
      store.upsertEdge(makeEdge({ id: 'e1', fromId: 'p1', toId: 'u1', label: 'hasUnit' })),
    ).rejects.toThrow(/toId/);
  });

  it('match() honours seed-class filter', async () => {
    const fx = smallEstateFixture();
    const store = createInMemoryStore({ seedNodes: fx.nodes, seedEdges: fx.edges });
    const sub = await store.match({ tenantId: TENANT, nodeClasses: ['Tenant'] });
    expect(sub.nodes.every((n) => n.class === 'Tenant')).toBe(true);
    expect(sub.nodes.length).toBe(2);
  });

  it('match() honours node-property filter', async () => {
    const fx = smallEstateFixture();
    const store = createInMemoryStore({ seedNodes: fx.nodes, seedEdges: fx.edges });
    const sub = await store.match({
      tenantId: TENANT,
      nodeClasses: ['Unit'],
      nodeProperties: { monthlyRent: 60000 },
    });
    expect(sub.nodes.map((n) => n.id)).toEqual(['u1']);
  });

  it('match() expands BFS within maxHops', async () => {
    const fx = smallEstateFixture();
    const store = createInMemoryStore({ seedNodes: fx.nodes, seedEdges: fx.edges });
    const sub = await store.match({
      tenantId: TENANT,
      seedNodeIds: ['p1'],
      maxHops: 1,
    });
    const ids = new Set(sub.nodes.map((n) => n.id));
    expect(ids.has('p1')).toBe(true);
    // 1 hop from Property: hasUnit→Unit, managedBy→EstateManager, locatedAt→Parcel
    expect(ids.has('u1')).toBe(true);
    expect(ids.has('u2')).toBe(true);
    expect(ids.has('mgr1')).toBe(true);
    expect(ids.has('parcel1')).toBe(true);
    // 2 hops away — should NOT yet be in
    expect(ids.has('t1')).toBe(false);
  });

  it('getNeighbors honours edge-label filter', async () => {
    const fx = smallEstateFixture();
    const store = createInMemoryStore({ seedNodes: fx.nodes, seedEdges: fx.edges });
    const neighbors = await store.getNeighbors({
      tenantId: TENANT,
      nodeId: 'p1',
      edgeLabels: ['hasUnit'],
    });
    // Only the two hasUnit edges
    expect(neighbors.edges.length).toBe(2);
    expect(neighbors.edges.every((e) => e.label === 'hasUnit')).toBe(true);
  });

  it('getNeighbors honours direction=in', async () => {
    const fx = smallEstateFixture();
    const store = createInMemoryStore({ seedNodes: fx.nodes, seedEdges: fx.edges });
    const neigh = await store.getNeighbors({
      tenantId: TENANT,
      nodeId: 'u1',
      direction: 'in',
    });
    const edgeIds = new Set(neigh.edges.map((e) => e.id));
    expect(edgeIds.has('e1')).toBe(true); // p1 -[hasUnit]-> u1 incoming
    expect(edgeIds.has('e7')).toBe(true); // l1 -[leaseOf]-> u1 incoming
    // outgoing edge u1 -[occupiedBy]-> t1 should NOT be present
    expect(edgeIds.has('e3')).toBe(false);
  });
});

describe('store adapters (deferred)', () => {
  it('createKuzuAdapter throws helpful error when driver missing', () => {
    expect(() =>
      createKuzuAdapter({ dbPath: '/tmp/x', driver: null as unknown as object }),
    ).toThrow(/driver is required/);
  });

  it('createNeo4jAdapter throws helpful error when driver missing', () => {
    expect(() =>
      createNeo4jAdapter({
        uri: 'bolt://localhost',
        auth: { username: 'u', password: 'p' },
        driver: null as unknown as object,
      }),
    ).toThrow(/driver is required/);
  });

  it('createKuzuAdapter throws when wired but unimplemented', () => {
    expect(() =>
      createKuzuAdapter({ dbPath: '/tmp/x', driver: {} }),
    ).toThrow(/not implemented/);
  });
});
