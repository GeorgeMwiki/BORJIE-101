/**
 * Bi-temporal facts tests — point-in-time state + diffs.
 */
import { describe, expect, it } from 'vitest';
import { compareStates, getStateAt } from '../temporal/index.js';
import { createInMemoryStore } from '../store/in-memory.js';
import { TENANT, makeEdge, makeNode } from './fixtures.js';

describe('getStateAt', () => {
  it('returns only facts that are valid at the timestamp', async () => {
    const store = createInMemoryStore();
    // Two leases: l1 valid Jan-Feb, l2 valid Mar+
    await store.upsertNode(
      makeNode({
        id: 'l1',
        class: 'Lease',
        validFrom: '2025-01-01',
        validTo: '2025-03-01',
        recordedAt: '2025-01-01',
      }),
    );
    await store.upsertNode(
      makeNode({
        id: 'l2',
        class: 'Lease',
        validFrom: '2025-03-01',
        validTo: '2025-12-31',
        recordedAt: '2025-03-01',
      }),
    );
    const feb = await getStateAt({
      store,
      tenantId: TENANT,
      timestamp: '2025-02-01',
    });
    expect(feb.nodes.map((n) => n.id)).toEqual(['l1']);
    const apr = await getStateAt({
      store,
      tenantId: TENANT,
      timestamp: '2025-04-01',
    });
    expect(apr.nodes.map((n) => n.id)).toEqual(['l2']);
  });

  it('excludes facts recorded after the timestamp', async () => {
    const store = createInMemoryStore();
    await store.upsertNode(
      makeNode({
        id: 'p1',
        class: 'Property',
        validFrom: '2025-01-01',
        recordedAt: '2025-05-01', // recorded much later
      }),
    );
    const inJan = await getStateAt({
      store,
      tenantId: TENANT,
      timestamp: '2025-02-01',
    });
    // Even though the fact is "valid" in Jan, we hadn't recorded it yet
    expect(inJan.nodes.length).toBe(0);
    const inJun = await getStateAt({
      store,
      tenantId: TENANT,
      timestamp: '2025-06-01',
    });
    expect(inJun.nodes.length).toBe(1);
  });

  it('only includes edges whose endpoints are also live', async () => {
    const store = createInMemoryStore();
    await store.upsertNode(makeNode({ id: 'p1', class: 'Property' }));
    await store.upsertNode(
      makeNode({
        id: 'u1',
        class: 'Unit',
        validFrom: '2025-06-01', // not yet valid in Feb
      }),
    );
    await store.upsertEdge(
      makeEdge({ id: 'e1', fromId: 'p1', toId: 'u1', label: 'hasUnit' }),
    );
    const feb = await getStateAt({
      store,
      tenantId: TENANT,
      timestamp: '2025-02-01',
    });
    expect(feb.edges.length).toBe(0); // edge dropped because u1 not live
    expect(feb.nodes.map((n) => n.id)).toEqual(['p1']);
  });

  it('errors on missing tenantId', async () => {
    const store = createInMemoryStore();
    await expect(
      getStateAt({ store, tenantId: '', timestamp: '2025-01-01' }),
    ).rejects.toThrow(/tenantId/);
  });

  it('errors on invalid timestamp', async () => {
    const store = createInMemoryStore();
    await expect(
      getStateAt({ store, tenantId: TENANT, timestamp: 'not-a-date' }),
    ).rejects.toThrow(/timestamp/);
  });
});

describe('compareStates', () => {
  it('surfaces added + removed nodes between two moments', async () => {
    const store = createInMemoryStore();
    await store.upsertNode(
      makeNode({
        id: 'l1',
        class: 'Lease',
        validFrom: '2025-01-01',
        validTo: '2025-03-01',
        recordedAt: '2025-01-01',
      }),
    );
    await store.upsertNode(
      makeNode({
        id: 'l2',
        class: 'Lease',
        validFrom: '2025-03-01',
        validTo: '2025-12-31',
        recordedAt: '2025-03-01',
      }),
    );
    const diff = await compareStates({
      store,
      tenantId: TENANT,
      t1: '2025-02-01',
      t2: '2025-04-01',
    });
    expect(diff.removedNodeIds).toContain('l1');
    expect(diff.addedNodeIds).toContain('l2');
  });

  it('surfaces edge changes when endpoints are added later', async () => {
    const store = createInMemoryStore();
    await store.upsertNode(makeNode({ id: 'p1', class: 'Property' }));
    await store.upsertNode(
      makeNode({
        id: 'u1',
        class: 'Unit',
        validFrom: '2025-06-01',
        recordedAt: '2025-06-01',
      }),
    );
    await store.upsertEdge(
      makeEdge({
        id: 'e1',
        fromId: 'p1',
        toId: 'u1',
        label: 'hasUnit',
        validFrom: '2025-06-01',
        recordedAt: '2025-06-01',
      }),
    );
    const diff = await compareStates({
      store,
      tenantId: TENANT,
      t1: '2025-02-01',
      t2: '2025-07-01',
    });
    expect(diff.addedEdgeIds).toContain('e1');
    expect(diff.addedNodeIds).toContain('u1');
  });
});
