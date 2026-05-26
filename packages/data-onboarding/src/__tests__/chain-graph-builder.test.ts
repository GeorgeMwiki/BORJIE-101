import { describe, expect, it } from 'vitest';
import { buildChainGraph } from '../profile-chain/chain-graph-builder.js';
import type { TenantSchemaCtx, TenantTable } from '../types.js';

const WORKERS: TenantTable = Object.freeze({
  schema: 'public',
  table: 'workers',
  entity_type_hint: 'worker' as const,
  columns: Object.freeze([
    { name: 'id', type: 'uuid', nullable: false, is_pk: true, is_unique: true },
    { name: 'nida', type: 'text', nullable: false, is_pk: false, is_unique: true },
  ]),
});

const SHIFTS: TenantTable = Object.freeze({
  schema: 'public',
  table: 'shift_assignments',
  entity_type_hint: 'shift' as const,
  columns: Object.freeze([
    { name: 'id', type: 'uuid', nullable: false, is_pk: true, is_unique: true },
    {
      name: 'worker_id',
      type: 'uuid',
      nullable: false,
      is_pk: false,
      is_unique: false,
    },
    { name: 'shift_date', type: 'date', nullable: false, is_pk: false, is_unique: false },
  ]),
});

const INCIDENTS: TenantTable = Object.freeze({
  schema: 'public',
  table: 'incidents',
  entity_type_hint: 'incident' as const,
  columns: Object.freeze([
    { name: 'id', type: 'uuid', nullable: false, is_pk: true, is_unique: true },
    {
      name: 'worker_id',
      type: 'uuid',
      nullable: true,
      is_pk: false,
      is_unique: false,
    },
    { name: 'severity', type: 'text', nullable: false, is_pk: false, is_unique: false },
  ]),
});

function ctx(tables: ReadonlyArray<TenantTable>): TenantSchemaCtx {
  return Object.freeze({
    tenant_id: 'test_tenant',
    tables: Object.freeze(tables),
  });
}

describe('buildChainGraph', () => {
  it('walks the schema for tables joining back to the root', () => {
    const graph = buildChainGraph({
      root_entity: 'worker',
      root_table: 'workers',
      ctx: ctx([WORKERS, SHIFTS, INCIDENTS]),
    });
    expect(graph.root_entity).toBe('worker');
    expect(graph.chain_nodes).toHaveLength(2);
    expect(graph.chain_nodes.map((n) => n.table)).toEqual([
      'shift_assignments',
      'incidents',
    ]);
  });

  it('produces a tab-layout proposal', () => {
    const graph = buildChainGraph({
      root_entity: 'worker',
      root_table: 'workers',
      ctx: ctx([WORKERS, SHIFTS, INCIDENTS]),
    });
    expect(graph.suggested_tab_layout.tab_recipe_id).toBe(
      'tab_worker_profile_v1',
    );
    expect(
      graph.suggested_tab_layout.list_view_fields.length,
    ).toBeGreaterThan(0);
  });

  it('returns an empty chain when no joins exist', () => {
    const graph = buildChainGraph({
      root_entity: 'worker',
      root_table: 'workers',
      ctx: ctx([WORKERS]),
    });
    expect(graph.chain_nodes).toHaveLength(0);
  });
});
