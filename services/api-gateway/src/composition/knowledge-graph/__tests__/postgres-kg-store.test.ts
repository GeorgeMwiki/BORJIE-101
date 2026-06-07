/**
 * Unit tests for the Postgres `KGStorePort` adapter.
 *
 * The adapter is pure over a `KgDbExec` seam (`execute(sql)`), so we stub it
 * with a queue of canned responses and assert (a) the package's `KGStorePort`
 * contract is honoured, (b) tenant scoping is enforced, (c) rows map back to
 * the package's `Node` / `Edge` shape, and (d) the edge endpoint guard fires.
 *
 * No real DB — this is the unit layer; RLS / pgvector are exercised by the
 * migration-apply + integration suites.
 */

import { describe, expect, it, vi } from 'vitest';
import { createPostgresKgStore, type KgDbExec } from '../postgres-kg-store.js';

/** Build a stub db whose `execute` returns successive canned results. */
function stubDb(responses: ReadonlyArray<unknown>): {
  db: KgDbExec;
  calls: { execute: ReturnType<typeof vi.fn> };
} {
  let i = 0;
  const execute = vi.fn(async () => {
    const r = responses[i] ?? [];
    i += 1;
    return r;
  });
  return { db: { execute }, calls: { execute } };
}

const TENANT = 'tenant-abc';

describe('createPostgresKgStore', () => {
  it('rejects an empty tenantId on reads', async () => {
    const { db } = stubDb([]);
    const store = createPostgresKgStore(db);
    await expect(store.allNodes('')).rejects.toThrow(/tenantId is required/);
  });

  it('maps a node row back to the package Node shape', async () => {
    const { db } = stubDb([
      [
        {
          id: 'estate_entity:e1',
          tenant_id: TENANT,
          kind: 'estate_entity',
          entity_ref: 'e1',
          label: 'Acme Mining Ltd',
          props: { entity_kind: 'operating_company', label: 'Acme Mining Ltd' },
        },
      ],
    ]);
    const store = createPostgresKgStore(db);
    const node = await store.getNode({ tenantId: TENANT, id: 'estate_entity:e1' });
    expect(node).not.toBeNull();
    expect(node?.id).toBe('estate_entity:e1');
    expect(node?.class).toBe('estate_entity');
    expect(node?.tenantId).toBe(TENANT);
    expect(node?.properties.entity_kind).toBe('operating_company');
  });

  it('upserts a node via ON CONFLICT and derives (kind, entity_ref)', async () => {
    const { db, calls } = stubDb([[]]);
    const store = createPostgresKgStore(db);
    await store.upsertNode({
      id: 'staff:s1',
      class: 'staff',
      tenantId: TENANT,
      properties: { role: 'engineer', label: 'Jane Doe' },
    });
    expect(calls.execute).toHaveBeenCalledTimes(1);
    // The SQL fragment carries an ON CONFLICT upsert keyed by the unique index.
    const arg = calls.execute.mock.calls[0]?.[0] as { queryChunks?: unknown[] };
    const text = JSON.stringify(arg);
    expect(text).toContain('kg_nodes');
    expect(text).toContain('ON CONFLICT');
  });

  it('guards edge endpoints: throws when both nodes are not present', async () => {
    // First execute = endpoint existence probe → only 1 of 2 nodes present.
    const { db } = stubDb([[{ n: 1 }]]);
    const store = createPostgresKgStore(db);
    await expect(
      store.upsertEdge({
        id: 'a|owns|b',
        fromId: 'estate_group:a',
        toId: 'estate_entity:b',
        label: 'owns',
        tenantId: TENANT,
        properties: {},
      }),
    ).rejects.toThrow(/both endpoints must exist/);
  });

  it('inserts an edge when both endpoints exist', async () => {
    // probe → 2 present; then the INSERT.
    const { db, calls } = stubDb([[{ n: 2 }], []]);
    const store = createPostgresKgStore(db);
    await store.upsertEdge({
      id: 'a|owns|b',
      fromId: 'estate_group:a',
      toId: 'estate_entity:b',
      label: 'owns',
      tenantId: TENANT,
      properties: { weight: 1 },
    });
    expect(calls.execute).toHaveBeenCalledTimes(2);
    const insertArg = JSON.stringify(calls.execute.mock.calls[1]?.[0]);
    expect(insertArg).toContain('kg_edges');
    expect(insertArg).toContain('ON CONFLICT');
  });

  it('getNeighbors returns a tenant-scoped subgraph (edges + hydrated nodes)', async () => {
    const { db } = stubDb([
      // edges touching the node
      [
        {
          id: 'g|owns|e',
          tenant_id: TENANT,
          src_node_id: 'estate_group:g',
          dst_node_id: 'estate_entity:e',
          relation: 'owns',
          weight: 1,
          props: {},
        },
      ],
      // hydrate nodes (both endpoints)
      [
        {
          id: 'estate_group:g',
          tenant_id: TENANT,
          kind: 'estate_group',
          entity_ref: 'g',
          label: 'Group',
          props: {},
        },
        {
          id: 'estate_entity:e',
          tenant_id: TENANT,
          kind: 'estate_entity',
          entity_ref: 'e',
          label: 'Entity',
          props: {},
        },
      ],
    ]);
    const store = createPostgresKgStore(db);
    const sub = await store.getNeighbors({
      tenantId: TENANT,
      nodeId: 'estate_group:g',
      direction: 'both',
    });
    expect(sub.tenantId).toBe(TENANT);
    expect(sub.edges).toHaveLength(1);
    expect(sub.edges[0]?.label).toBe('owns');
    expect(sub.nodes.map((n) => n.id).sort()).toEqual([
      'estate_entity:e',
      'estate_group:g',
    ]);
  });
});
