import { describe, expect, it } from 'vitest';
import { workerOnboardingRecipe } from '../recipes/worker-onboarding.js';
import { DataOnboardingRecipeRegistry } from '../recipes/registry.js';
import type {
  TabularSample,
  TenantSchemaCtx,
  TenantTable,
} from '../types.js';

const WORKERS_TABLE: TenantTable = Object.freeze({
  schema: 'public',
  table: 'workers',
  entity_type_hint: 'worker' as const,
  columns: Object.freeze([
    { name: 'id', type: 'uuid', nullable: false, is_pk: true, is_unique: true },
    {
      name: 'nida',
      type: 'text',
      nullable: false,
      is_pk: false,
      is_unique: true,
    },
    { name: 'name', type: 'text', nullable: false, is_pk: false, is_unique: false },
    { name: 'role', type: 'text', nullable: true, is_pk: false, is_unique: false },
  ]),
});

const SHIFTS_TABLE: TenantTable = Object.freeze({
  schema: 'public',
  table: 'shift_assignments',
  columns: Object.freeze([
    { name: 'id', type: 'uuid', nullable: false, is_pk: true, is_unique: true },
    {
      name: 'worker_id',
      type: 'uuid',
      nullable: false,
      is_pk: false,
      is_unique: false,
    },
  ]),
});

const SAMPLE: TabularSample = Object.freeze({
  source_file: { id: 'f1', name: 'employees_q3.xlsx', sheet: 'Sheet1' },
  headers: Object.freeze([
    'NIDA',
    'name',
    'role',
    'next_of_kin_phone',
    'blood_type',
  ]),
  rows: Object.freeze([
    Object.freeze([
      '19990321-12345-67890-12',
      'Asha Mwangi',
      'driller',
      '+255 712 345 678',
      'O+',
    ]),
    Object.freeze([
      '19880415-22345-67800-99',
      'John Mahundi',
      'driver',
      '+255 754 999 111',
      'A-',
    ]),
  ]),
  total_row_count: 2,
});

const CTX: TenantSchemaCtx = Object.freeze({
  tenant_id: 'test',
  tables: Object.freeze([WORKERS_TABLE, SHIFTS_TABLE]),
});

describe('workerOnboardingRecipe — end-to-end smoke', () => {
  it('discovers schema with high entity confidence', async () => {
    const discovered = await workerOnboardingRecipe.discover(SAMPLE);
    expect(discovered.inferred_entity_type).toBe('worker');
    expect(discovered.entity_confidence).toBeGreaterThan(0.5);
    expect(discovered.columns).toHaveLength(5);
    expect(discovered.inferred_primary_key).toBe('NIDA');
  });

  it('matches against the workers table', async () => {
    const discovered = await workerOnboardingRecipe.discover(SAMPLE);
    const match = await workerOnboardingRecipe.match(discovered, CTX);
    expect(match.target_table.table).toBe('workers');
    expect(match.column_mappings.length).toBeGreaterThan(0);
    expect(
      match.unmatched_columns.some((c) => c.name === 'next_of_kin_phone'),
    ).toBe(true);
  });

  it('emits add_column proposals for unmatched columns', async () => {
    const discovered = await workerOnboardingRecipe.discover(SAMPLE);
    const match = await workerOnboardingRecipe.match(discovered, CTX);
    const proposals = await workerOnboardingRecipe.propose_evolution(match);
    expect(proposals.length).toBeGreaterThanOrEqual(2);
    expect(proposals.every((p) => p.authority_tier === 2)).toBe(true);
  });

  it('builds a profile chain', async () => {
    const graph = await workerOnboardingRecipe.build_chain('worker', CTX);
    expect(graph.root_table).toBe('workers');
    expect(graph.chain_nodes.some((n) => n.table === 'shift_assignments')).toBe(
      true,
    );
  });

  it('registers via DataOnboardingRecipeRegistry', () => {
    const reg = new DataOnboardingRecipeRegistry();
    const r = reg.get('worker_onboarding');
    expect(r.id).toBe('worker_onboarding');
    expect(reg.forEntityType('worker')?.id).toBe('worker_onboarding');
    expect(reg.all()).toHaveLength(3);
  });
});
