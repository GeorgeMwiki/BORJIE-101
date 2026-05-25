/**
 * Piece A — Universal Asset & Entity Model tests.
 *
 * Three test groups (no live Postgres in CI; we model the canonical
 * behaviour in an in-process simulator following the
 * `section-layouts.test.ts` pattern from migration 0182):
 *
 *   1. Schema introspection — confirms the Drizzle table shapes match
 *      what migrations 0186-0194 install.
 *   2. Repository behaviour — covers insertEntity, recursive descent,
 *      custom-field validation, RLS isolation invariants, hybrid
 *      search ranking, MMR rerank.
 *   3. SQL generator — verifies the tsvector trigger generator yields
 *      the canonical weighted expression.
 *
 * The simulator pattern means we DON'T require a Postgres container in
 * CI; we model the (tenant_id GUC + RLS predicate + parent chain)
 * invariants in plain TS and assert against them.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import {
  coreEntity,
  entityExtBuilding,
  entityExtItAsset,
  entityExtLand,
  entityExtMachinery,
  entityExtPerson,
  entityExtVehicle,
  entityTypeDefinition,
  tenantSchemaExtensions,
  PLATFORM_BUILT_IN_ENTITY_TYPES,
  CORE_ENTITY_EMBEDDING_DIM,
  type CoreEntityRow,
  type EntityTypeDefinitionRow,
  type TenantSchemaExtensionRow,
} from '../schemas/core-entity/index.js';
import { mmrRerank } from '../repositories/core-entity.repository.js';
import type { CoreEntityInput } from '../repositories/core-entity.repository.js';
import {
  CORE_ENTITY_TSV_CONFIG,
  renderTsvBody,
  renderTsvTriggerSql,
} from '../helpers/tsv-trigger.js';
import {
  rehydrateZod,
  zodToPersistedMeta,
} from '../helpers/custom-field-zod.js';
import {
  ensurePostGis,
  probePostGis,
  type PostGisProbeClient,
} from '../helpers/postgis-install.js';

// ─────────────────────────────────────────────────────────────────────
// 1. Schema introspection — Drizzle config matches migration 0186-0194.
// ─────────────────────────────────────────────────────────────────────

describe('core_entity schema (migration 0186)', () => {
  it('declares the canonical column set', () => {
    const cfg = getTableConfig(coreEntity);
    const names = cfg.columns.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'id',
        'tenant_id',
        'module_id',
        'entity_type',
        'parent_entity_id',
        'discriminator',
        'display_name',
        'lifecycle_state',
        'geo_geog',
        'custom_fields',
        'embedding',
        'tsv',
        'audit_chain_root_hash',
        'created_at',
        'updated_at',
        'created_by',
        'deleted_at',
      ].sort(),
    );
  });

  it('uses 1536-dim embedding (OpenAI text-embedding-3-small)', () => {
    expect(CORE_ENTITY_EMBEDDING_DIM).toBe(1536);
  });

  it('declares (tenant_id, entity_type) index', () => {
    const cfg = getTableConfig(coreEntity);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'core_entity_type_idx',
    );
    expect(idx).toBeDefined();
  });

  it('declares (parent_entity_id) index for subdivision navigation', () => {
    const cfg = getTableConfig(coreEntity);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'core_entity_parent_idx',
    );
    expect(idx).toBeDefined();
  });

  it('declares tsvector GIN-style index for BM25 retrieval', () => {
    const cfg = getTableConfig(coreEntity);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'core_entity_tsv_idx',
    );
    expect(idx).toBeDefined();
  });
});

describe('entity_type_definition schema (migration 0187)', () => {
  it('exposes the canonical platform built-in slugs', () => {
    expect(PLATFORM_BUILT_IN_ENTITY_TYPES).toContain('LAND_PARCEL');
    expect(PLATFORM_BUILT_IN_ENTITY_TYPES).toContain('BUILDING');
    expect(PLATFORM_BUILT_IN_ENTITY_TYPES).toContain('SUB_UNIT');
    expect(PLATFORM_BUILT_IN_ENTITY_TYPES).toContain('VEHICLE');
    expect(PLATFORM_BUILT_IN_ENTITY_TYPES).toContain('MACHINERY');
    expect(PLATFORM_BUILT_IN_ENTITY_TYPES).toContain('IT_ASSET');
    expect(PLATFORM_BUILT_IN_ENTITY_TYPES).toContain('PERSON');
    expect(PLATFORM_BUILT_IN_ENTITY_TYPES).toContain('INTANGIBLE');
  });

  it('declares display_name_en and display_name_sw (bilingual EN+SW)', () => {
    const cfg = getTableConfig(entityTypeDefinition);
    const names = cfg.columns.map((c) => c.name);
    expect(names).toContain('display_name_en');
    expect(names).toContain('display_name_sw');
  });
});

describe('tenant_schema_extensions schema (migration 0188)', () => {
  it('declares zod_jsonb + field_kind + index_strategy', () => {
    const cfg = getTableConfig(tenantSchemaExtensions);
    const names = cfg.columns.map((c) => c.name);
    expect(names).toContain('zod_jsonb');
    expect(names).toContain('field_kind');
    expect(names).toContain('index_strategy');
    expect(names).toContain('validations_jsonb');
    expect(names).toContain('required');
  });
});

describe('entity_ext_* extension schemas (migrations 0189-0194)', () => {
  it('entity_ext_land has plot_number / hectares / fractional_area / railway_reserve', () => {
    const cfg = getTableConfig(entityExtLand);
    const names = cfg.columns.map((c) => c.name);
    expect(names).toContain('plot_number');
    expect(names).toContain('hectares');
    expect(names).toContain('fractional_area');
    expect(names).toContain('in_railway_reserve');
    expect(names).toContain('title_deed_ref');
  });

  it('entity_ext_building has building_type + floors + square_meters', () => {
    const cfg = getTableConfig(entityExtBuilding);
    const names = cfg.columns.map((c) => c.name);
    expect(names).toContain('building_type');
    expect(names).toContain('floors');
    expect(names).toContain('square_meters');
    expect(names).toContain('condition_rating');
  });

  it('entity_ext_vehicle has vin + license_plate + odometer', () => {
    const cfg = getTableConfig(entityExtVehicle);
    const names = cfg.columns.map((c) => c.name);
    expect(names).toContain('vin');
    expect(names).toContain('license_plate');
    expect(names).toContain('odometer_km');
    expect(names).toContain('status');
  });

  it('entity_ext_machinery has serial_number + manufacturer + hours_run', () => {
    const cfg = getTableConfig(entityExtMachinery);
    const names = cfg.columns.map((c) => c.name);
    expect(names).toContain('serial_number');
    expect(names).toContain('manufacturer');
    expect(names).toContain('hours_run');
    expect(names).toContain('warranty_expires');
  });

  it('entity_ext_it_asset has assigned_to_entity_id FK + device_kind', () => {
    const cfg = getTableConfig(entityExtItAsset);
    const names = cfg.columns.map((c) => c.name);
    expect(names).toContain('assigned_to_entity_id');
    expect(names).toContain('device_kind');
    expect(names).toContain('asset_tag');
  });

  it('entity_ext_person has supabase_user_id + nida_number + preferred_language', () => {
    const cfg = getTableConfig(entityExtPerson);
    const names = cfg.columns.map((c) => c.name);
    expect(names).toContain('supabase_user_id');
    expect(names).toContain('nida_number');
    expect(names).toContain('preferred_language');
    expect(names).toContain('email');
    expect(names).toContain('phone');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. tsv-trigger SQL generator — produces canonical weighted expression.
// ─────────────────────────────────────────────────────────────────────

describe('tsv-trigger SQL generator', () => {
  it('renders the canonical weighted body for core_entity', () => {
    const body = renderTsvBody(CORE_ENTITY_TSV_CONFIG);
    expect(body).toContain('setweight(to_tsvector');
    expect(body).toContain("'A'");
    expect(body).toContain("'B'");
    expect(body).toContain("'C'");
    expect(body).toContain('NEW.display_name');
    expect(body).toContain('NEW.discriminator');
    expect(body).toContain('NEW.entity_type');
    expect(body).toContain('NEW.custom_fields::text');
  });

  it('uses simple ts_config by default (language-agnostic)', () => {
    const body = renderTsvBody(CORE_ENTITY_TSV_CONFIG);
    expect(body).toContain("'simple'");
  });

  it('renders the full CREATE OR REPLACE FUNCTION + CREATE TRIGGER pair', () => {
    const sql = renderTsvTriggerSql(CORE_ENTITY_TSV_CONFIG);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION');
    expect(sql).toContain('public.core_entity_tsv_update');
    expect(sql).toContain('DROP TRIGGER IF EXISTS core_entity_tsv_trigger');
    expect(sql).toContain('CREATE TRIGGER core_entity_tsv_trigger');
    expect(sql).toContain('BEFORE INSERT OR UPDATE');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. MMR rerank — diversification + relevance trade-off.
// ─────────────────────────────────────────────────────────────────────

describe('MMR rerank', () => {
  it('returns single candidate as-is', () => {
    const out = mmrRerank(
      [{ id: 'a', display_name: 'one', combined: 1 }],
      0.5,
    );
    expect(out.map((c) => c.id)).toEqual(['a']);
  });

  it('orders by combined score when lambda = 1 (pure relevance)', () => {
    const out = mmrRerank(
      [
        { id: 'a', display_name: 'one', combined: 0.5 },
        { id: 'b', display_name: 'two', combined: 0.9 },
        { id: 'c', display_name: 'three', combined: 0.1 },
      ],
      1,
    );
    expect(out.map((c) => c.id)).toEqual(['b', 'a', 'c']);
  });

  it('diversifies away from token overlap when lambda is low', () => {
    // Two near-duplicates and one different name; with low lambda
    // (high diversity) the second pick should be the unique one.
    const out = mmrRerank(
      [
        { id: 'a', display_name: 'plot one acacia road', combined: 0.9 },
        { id: 'b', display_name: 'plot one acacia road north', combined: 0.85 },
        { id: 'c', display_name: 'warehouse mwakatundu', combined: 0.8 },
      ],
      0.1,
    );
    expect(out[0]?.id).toBe('a'); // highest combined
    // Second pick must be 'c' (no token overlap) not 'b' (heavy overlap).
    expect(out[1]?.id).toBe('c');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Repository simulator — models insert + recursive descent + RLS +
//    custom-field validation in a pure-TS substrate.
// ─────────────────────────────────────────────────────────────────────

interface SimEntity {
  readonly id: string;
  readonly tenantId: string;
  readonly entityType: string;
  readonly parentEntityId: string | null;
  readonly displayName: string;
  readonly lifecycleState: string;
  readonly customFields: Record<string, unknown>;
  readonly extension?: Record<string, unknown>;
}

interface SimCustomFieldDef {
  readonly fieldName: string;
  readonly fieldKind:
    | 'text'
    | 'number'
    | 'money'
    | 'date'
    | 'datetime'
    | 'boolean'
    | 'enum'
    | 'ref'
    | 'jsonb'
    | 'vector';
  readonly required: boolean;
  readonly validator: z.ZodTypeAny;
}

class CoreEntitySim {
  private currentTxGuc: string | null = null;
  private inTransaction = false;
  private readonly entities = new Map<string, SimEntity>();
  // Map<tenantId, Map<entityType, Array<SimCustomFieldDef>>>
  private readonly registry = new Map<
    string,
    Map<string, SimCustomFieldDef[]>
  >();

  begin(): void {
    if (this.inTransaction) throw new Error('tx already in progress');
    this.inTransaction = true;
    this.currentTxGuc = null;
  }

  commit(): void {
    if (!this.inTransaction) throw new Error('no tx');
    this.inTransaction = false;
    this.currentTxGuc = null;
  }

  setLocalTenantId(tenantId: string): void {
    if (!this.inTransaction) throw new Error('SET LOCAL needs tx');
    this.currentTxGuc = tenantId;
  }

  /** RLS WITH CHECK predicate on INSERT. */
  insertEntity(entity: SimEntity): void {
    if (!this.inTransaction) throw new Error('INSERT needs tx');
    if (this.currentTxGuc !== entity.tenantId) {
      throw new Error(
        `RLS WITH CHECK failed: GUC=${this.currentTxGuc ?? 'NULL'} != row.tenant_id=${entity.tenantId}`,
      );
    }
    // Validate custom fields against registry.
    const tenantReg = this.registry.get(entity.tenantId);
    const typeReg = tenantReg?.get(entity.entityType) ?? [];
    for (const def of typeReg) {
      const value = entity.customFields[def.fieldName];
      const missing = value === undefined || value === null;
      if (def.required && missing) {
        throw new Error(
          `custom field "${def.fieldName}" is required but missing`,
        );
      }
      if (missing) continue;
      const parsed = def.validator.safeParse(value);
      if (!parsed.success) {
        throw new Error(
          `custom field "${def.fieldName}" failed validation: ${parsed.error.message}`,
        );
      }
    }
    // Validate parent chain stays inside the same tenant.
    if (entity.parentEntityId) {
      const parent = this.entities.get(entity.parentEntityId);
      if (!parent) {
        throw new Error(
          `parent_entity_id=${entity.parentEntityId} not found`,
        );
      }
      if (parent.tenantId !== entity.tenantId) {
        throw new Error(
          `parent ${entity.parentEntityId} is in another tenant`,
        );
      }
    }
    this.entities.set(entity.id, entity);
  }

  /** RLS SELECT predicate. */
  findById(id: string): SimEntity | null {
    if (!this.inTransaction) throw new Error('SELECT needs tx');
    if (!this.currentTxGuc) return null;
    const e = this.entities.get(id);
    if (!e) return null;
    return e.tenantId === this.currentTxGuc ? e : null;
  }

  /** Recursive CTE — descend from a root, RLS-filtered. */
  findAllDescendants(rootId: string): ReadonlyArray<SimEntity> {
    if (!this.inTransaction) throw new Error('SELECT needs tx');
    if (!this.currentTxGuc) return [];
    const root = this.entities.get(rootId);
    if (!root || root.tenantId !== this.currentTxGuc) return [];

    const out: SimEntity[] = [root];
    const queue: string[] = [rootId];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) break;
      for (const [, candidate] of this.entities) {
        if (
          candidate.parentEntityId === cur &&
          candidate.tenantId === this.currentTxGuc
        ) {
          out.push(candidate);
          queue.push(candidate.id);
        }
      }
    }
    return out;
  }

  registerCustomField(
    tenantId: string,
    entityType: string,
    def: SimCustomFieldDef,
  ): void {
    if (!this.registry.has(tenantId)) this.registry.set(tenantId, new Map());
    const tenantReg = this.registry.get(tenantId);
    if (!tenantReg) throw new Error('unreachable');
    if (!tenantReg.has(entityType)) tenantReg.set(entityType, []);
    tenantReg.get(entityType)?.push(def);
  }
}

const TENANT_A = '00000000-0000-0000-0000-00000000aaaa';
const TENANT_B = '00000000-0000-0000-0000-00000000bbbb';

describe('CoreEntityRepository invariants (simulator)', () => {
  let sim: CoreEntitySim;

  beforeEach(() => {
    sim = new CoreEntitySim();
  });

  it('insert + findById round-trips inside the same tenant', () => {
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    sim.insertEntity({
      id: 'land-1',
      tenantId: TENANT_A,
      entityType: 'LAND_PARCEL',
      parentEntityId: null,
      displayName: 'Plot 42 Acacia Road',
      lifecycleState: 'active',
      customFields: {},
      extension: { hectares: 1.5 },
    });
    const found = sim.findById('land-1');
    sim.commit();

    expect(found?.id).toBe('land-1');
    expect(found?.entityType).toBe('LAND_PARCEL');
  });

  it('subdivides a land parcel 3 ways via parent_entity_id', () => {
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    sim.insertEntity({
      id: 'parent-land',
      tenantId: TENANT_A,
      entityType: 'LAND_PARCEL',
      parentEntityId: null,
      displayName: 'Original Title 100ha',
      lifecycleState: 'active',
      customFields: {},
      extension: { hectares: 100 },
    });
    for (const part of ['a', 'b', 'c']) {
      sim.insertEntity({
        id: `child-${part}`,
        tenantId: TENANT_A,
        entityType: 'LAND_PARCEL',
        parentEntityId: 'parent-land',
        displayName: `Sub-parcel ${part}`,
        lifecycleState: 'active',
        customFields: {},
        extension: {
          hectares: part === 'a' ? 50 : part === 'b' ? 25 : 25,
          fractional_area: part === 'a' ? 0.5 : 0.25,
        },
      });
    }
    const descendants = sim.findAllDescendants('parent-land');
    sim.commit();

    expect(descendants).toHaveLength(4); // root + 3 children
    expect(
      descendants.filter((d) => d.parentEntityId === 'parent-land'),
    ).toHaveLength(3);
  });

  it('recursive CTE returns all descendants across two levels', () => {
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    sim.insertEntity({
      id: 'building-1',
      tenantId: TENANT_A,
      entityType: 'BUILDING',
      parentEntityId: null,
      displayName: 'Acacia Towers',
      lifecycleState: 'active',
      customFields: {},
    });
    sim.insertEntity({
      id: 'unit-1a',
      tenantId: TENANT_A,
      entityType: 'SUB_UNIT',
      parentEntityId: 'building-1',
      displayName: '1A',
      lifecycleState: 'active',
      customFields: {},
    });
    sim.insertEntity({
      id: 'unit-1b',
      tenantId: TENANT_A,
      entityType: 'SUB_UNIT',
      parentEntityId: 'building-1',
      displayName: '1B',
      lifecycleState: 'active',
      customFields: {},
    });
    const descendants = sim.findAllDescendants('building-1');
    sim.commit();

    expect(descendants).toHaveLength(3);
    const ids = descendants.map((d) => d.id).sort();
    expect(ids).toEqual(['building-1', 'unit-1a', 'unit-1b']);
  });

  it('inserts a vehicle + a person + an IT asset linked to the person', () => {
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    sim.insertEntity({
      id: 'person-1',
      tenantId: TENANT_A,
      entityType: 'PERSON',
      parentEntityId: null,
      displayName: 'Asha Mwakatundu',
      lifecycleState: 'active',
      customFields: {},
    });
    sim.insertEntity({
      id: 'vehicle-1',
      tenantId: TENANT_A,
      entityType: 'VEHICLE',
      parentEntityId: null,
      displayName: 'Land Cruiser KAA 123',
      lifecycleState: 'active',
      customFields: {},
    });
    sim.insertEntity({
      id: 'laptop-1',
      tenantId: TENANT_A,
      entityType: 'IT_ASSET',
      parentEntityId: null,
      displayName: 'MacBook Pro 16"',
      lifecycleState: 'active',
      customFields: { assigned_to: 'person-1' },
    });
    const laptop = sim.findById('laptop-1');
    sim.commit();

    expect(laptop?.customFields.assigned_to).toBe('person-1');
  });

  it('RLS prevents cross-tenant SELECT (Tenant B cannot read Tenant A entities)', () => {
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    sim.insertEntity({
      id: 'private-asset',
      tenantId: TENANT_A,
      entityType: 'LAND_PARCEL',
      parentEntityId: null,
      displayName: 'Private',
      lifecycleState: 'active',
      customFields: {},
    });
    sim.commit();

    sim.begin();
    sim.setLocalTenantId(TENANT_B);
    const lookup = sim.findById('private-asset');
    sim.commit();

    expect(lookup).toBeNull();
  });

  it('RLS WITH CHECK refuses INSERT where row.tenant_id ≠ GUC', () => {
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    expect(() =>
      sim.insertEntity({
        id: 'bad-row',
        tenantId: TENANT_B,
        entityType: 'LAND_PARCEL',
        parentEntityId: null,
        displayName: 'Foreign',
        lifecycleState: 'active',
        customFields: {},
      }),
    ).toThrow(/RLS WITH CHECK failed/);
    sim.commit();
  });

  it('parent chain validation rejects cross-tenant parent reference', () => {
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    sim.insertEntity({
      id: 'a-root',
      tenantId: TENANT_A,
      entityType: 'BUILDING',
      parentEntityId: null,
      displayName: 'A root',
      lifecycleState: 'active',
      customFields: {},
    });
    sim.commit();

    sim.begin();
    sim.setLocalTenantId(TENANT_B);
    expect(() =>
      sim.insertEntity({
        id: 'b-child',
        tenantId: TENANT_B,
        entityType: 'SUB_UNIT',
        parentEntityId: 'a-root',
        displayName: 'B trying to attach to A',
        lifecycleState: 'active',
        customFields: {},
      }),
    ).toThrow(/in another tenant/);
    sim.commit();
  });

  it('custom-field validation rejects malformed JSONB', () => {
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    sim.registerCustomField(TENANT_A, 'LAND_PARCEL', {
      fieldName: 'irrigation_score',
      fieldKind: 'number',
      required: true,
      validator: z.number().min(0).max(10),
    });
    expect(() =>
      sim.insertEntity({
        id: 'bad-land',
        tenantId: TENANT_A,
        entityType: 'LAND_PARCEL',
        parentEntityId: null,
        displayName: 'Bad',
        lifecycleState: 'active',
        customFields: { irrigation_score: 'high' /* should be number */ },
      }),
    ).toThrow(/irrigation_score/);
    sim.commit();
  });

  it('custom-field validation accepts a well-formed JSONB', () => {
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    sim.registerCustomField(TENANT_A, 'LAND_PARCEL', {
      fieldName: 'irrigation_score',
      fieldKind: 'number',
      required: true,
      validator: z.number().min(0).max(10),
    });
    sim.insertEntity({
      id: 'good-land',
      tenantId: TENANT_A,
      entityType: 'LAND_PARCEL',
      parentEntityId: null,
      displayName: 'Good',
      lifecycleState: 'active',
      customFields: { irrigation_score: 7 },
    });
    const found = sim.findById('good-land');
    sim.commit();

    expect(found?.customFields.irrigation_score).toBe(7);
  });

  it('custom-field validation rejects missing required field', () => {
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    sim.registerCustomField(TENANT_A, 'BUILDING', {
      fieldName: 'fire_certificate_no',
      fieldKind: 'text',
      required: true,
      validator: z.string().min(1),
    });
    expect(() =>
      sim.insertEntity({
        id: 'missing-required',
        tenantId: TENANT_A,
        entityType: 'BUILDING',
        parentEntityId: null,
        displayName: 'Building without fire cert',
        lifecycleState: 'active',
        customFields: {},
      }),
    ).toThrow(/fire_certificate_no.*required/);
    sim.commit();
  });

  it('hybrid search ranking — simulated combined score selects best hit first', () => {
    // Construct candidates with known per-signal scores; verify MMR
    // top-1 pick equals the candidate with the highest combined.
    const candidates = [
      { id: 'land-1', display_name: 'plot 42 acacia', combined: 0.9 },
      { id: 'land-2', display_name: 'godown b mwakatundu', combined: 0.7 },
      { id: 'land-3', display_name: 'plot 99 baobab', combined: 0.5 },
    ];
    const reranked = mmrRerank(candidates, 0.5);
    expect(reranked[0]?.id).toBe('land-1');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Type contract — ensure the public input shape is correctly
//    discriminated.
// ─────────────────────────────────────────────────────────────────────

describe('CoreEntityInput discriminated union', () => {
  it('accepts a LandEntityInput shape', () => {
    const input: CoreEntityInput = {
      id: 'land-x',
      entityType: 'LAND_PARCEL',
      displayName: 'X',
      land: {
        plotNumber: 'P/42',
        hectares: '1.5',
        fractionalArea: null,
        inRailwayReserve: false,
        zoning: 'residential',
        landUse: 'residential',
        titleDeedRef: null,
        surveyedAt: null,
      },
    };
    expect(input.entityType).toBe('LAND_PARCEL');
  });

  it('accepts a PersonEntityInput shape', () => {
    const input: CoreEntityInput = {
      id: 'person-x',
      entityType: 'PERSON',
      displayName: 'Test',
      person: {
        supabaseUserId: null,
        email: 'a@b.test',
        phone: null,
        nidaNumber: null,
        firstName: 'Test',
        lastName: 'Person',
        preferredLanguage: 'sw',
      },
    };
    expect(input.entityType).toBe('PERSON');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5.5 Custom-field Zod helpers — pure-function unit coverage.
// ─────────────────────────────────────────────────────────────────────

describe('zodToPersistedMeta', () => {
  it('persists the Zod typeName as the kind hint', () => {
    const meta = zodToPersistedMeta(z.string());
    expect(meta.kind).toBe('ZodString');
  });

  it('persists a description when present', () => {
    const meta = zodToPersistedMeta(
      z.string().describe('User-facing label'),
    );
    expect(meta.description).toBe('User-facing label');
  });

  it('falls back to "unknown" when the typeName is missing', () => {
    const fake = { description: null, _def: {} } as unknown as z.ZodTypeAny;
    const meta = zodToPersistedMeta(fake);
    expect(meta.kind).toBe('unknown');
  });
});

describe('rehydrateZod', () => {
  it('rebuilds a text validator from fieldKind=text', () => {
    const v = rehydrateZod({ fieldKind: 'text', validationsJsonb: [] });
    expect(v.safeParse('hello').success).toBe(true);
    expect(v.safeParse(42).success).toBe(false);
  });

  it('rebuilds a number validator from fieldKind=number', () => {
    const v = rehydrateZod({ fieldKind: 'number', validationsJsonb: [] });
    expect(v.safeParse(42).success).toBe(true);
    expect(v.safeParse('42').success).toBe(false);
  });

  it('rebuilds a money validator as int (no fractional cents)', () => {
    const v = rehydrateZod({ fieldKind: 'money', validationsJsonb: [] });
    expect(v.safeParse(1500).success).toBe(true);
    expect(v.safeParse(15.5).success).toBe(false);
  });

  it('rebuilds a boolean validator', () => {
    const v = rehydrateZod({ fieldKind: 'boolean', validationsJsonb: [] });
    expect(v.safeParse(true).success).toBe(true);
    expect(v.safeParse('true').success).toBe(false);
  });

  it('rebuilds an enum validator from validations[].values', () => {
    const v = rehydrateZod({
      fieldKind: 'enum',
      validationsJsonb: [{ rule: 'enum', values: ['gold', 'silver', 'bronze'] }],
    });
    expect(v.safeParse('gold').success).toBe(true);
    expect(v.safeParse('platinum').success).toBe(false);
  });

  it('falls back to z.string() for enum without values', () => {
    const v = rehydrateZod({ fieldKind: 'enum', validationsJsonb: [] });
    expect(v.safeParse('whatever').success).toBe(true);
  });

  it('honours min/max constraints on text fields', () => {
    const v = rehydrateZod({
      fieldKind: 'text',
      validationsJsonb: [{ min: 3, max: 5 }],
    });
    expect(v.safeParse('hi').success).toBe(false);
    expect(v.safeParse('hello').success).toBe(true);
    expect(v.safeParse('howdyy').success).toBe(false);
  });

  it('honours min/max constraints on number fields', () => {
    const v = rehydrateZod({
      fieldKind: 'number',
      validationsJsonb: [{ min: 0, max: 10 }],
    });
    expect(v.safeParse(-1).success).toBe(false);
    expect(v.safeParse(5).success).toBe(true);
    expect(v.safeParse(11).success).toBe(false);
  });

  it('honours pattern constraint on text fields', () => {
    const v = rehydrateZod({
      fieldKind: 'text',
      validationsJsonb: [{ pattern: '^[A-Z]{3}-[0-9]{4}$' }],
    });
    expect(v.safeParse('ABC-1234').success).toBe(true);
    expect(v.safeParse('abc-1234').success).toBe(false);
  });

  it('rebuilds a ref validator as a string', () => {
    const v = rehydrateZod({ fieldKind: 'ref', validationsJsonb: [] });
    expect(v.safeParse('some-entity-id').success).toBe(true);
  });

  it('rebuilds a date validator (ISO-string)', () => {
    const v = rehydrateZod({ fieldKind: 'date', validationsJsonb: [] });
    expect(v.safeParse('2026-05-22').success).toBe(true);
  });

  it('rebuilds a vector validator', () => {
    const v = rehydrateZod({ fieldKind: 'vector', validationsJsonb: [] });
    expect(v.safeParse([0.1, 0.2, 0.3]).success).toBe(true);
    expect(v.safeParse('not-an-array').success).toBe(false);
  });

  it('rebuilds a jsonb validator as any', () => {
    const v = rehydrateZod({ fieldKind: 'jsonb', validationsJsonb: [] });
    expect(v.safeParse({ nested: { thing: true } }).success).toBe(true);
  });

  it('falls back to z.any() for unknown fieldKind', () => {
    const v = rehydrateZod({
      fieldKind: 'mystery' as unknown as 'text',
      validationsJsonb: [],
    });
    expect(v.safeParse({ anything: true }).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5.6 PostGIS probe — fakes the DB client to exercise both branches.
// ─────────────────────────────────────────────────────────────────────

describe('postgis probe + ensure', () => {
  /**
   * Decode a Drizzle `sql` chunk array to a flat string for the fake
   * client. Drizzle's `sql` template emits an object with a
   * `queryChunks` array of `{ value: string }` parts and parameter
   * placeholders; we just join the string parts.
   */
  function chunksToString(q: unknown): string {
    const chunks =
      (q as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? [];
    return chunks
      .map((c) => {
        if (typeof c === 'string') return c;
        if (
          c &&
          typeof c === 'object' &&
          'value' in c &&
          Array.isArray((c as { value: unknown[] }).value)
        ) {
          return (c as { value: string[] }).value.join('');
        }
        return '';
      })
      .join('');
  }

  function makeClient(
    behaviour: (queryText: string) => Promise<unknown>,
  ): PostGisProbeClient {
    return {
      execute: async (q) => behaviour(chunksToString(q)),
    };
  }

  it('reports unavailable when no row matches', async () => {
    const probe = await probePostGis(
      makeClient(async () => ({ rows: [] })),
    );
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain('not installed');
  });

  it('reports available with extversion when row exists', async () => {
    const probe = await probePostGis(
      makeClient(async () => ({ rows: [{ extversion: '3.4.0' }] })),
    );
    expect(probe.available).toBe(true);
    expect(probe.version).toBe('3.4.0');
  });

  it('reports unavailable with a reason on driver error', async () => {
    const probe = await probePostGis(
      makeClient(async () => {
        throw new Error('connection refused');
      }),
    );
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain('connection refused');
  });

  it('ensurePostGis returns the probe after attempted install', async () => {
    let installed = false;
    const result = await ensurePostGis(
      makeClient(async (queryText) => {
        if (queryText.includes('CREATE EXTENSION')) {
          installed = true;
          return undefined;
        }
        return { rows: installed ? [{ extversion: '3.4.0' }] : [] };
      }),
    );
    expect(result.available).toBe(true);
  });

  it('ensurePostGis falls through gracefully when install errors but probe succeeds', async () => {
    // Simulates the privilege-denied path: install fails but the
    // extension is already present (was installed by an operator).
    const result = await ensurePostGis(
      makeClient(async (queryText) => {
        if (queryText.includes('CREATE EXTENSION')) {
          throw new Error('insufficient_privilege');
        }
        return { rows: [{ extversion: '3.4.0' }] };
      }),
    );
    expect(result.available).toBe(true);
  });

  it('ensurePostGis returns unavailable when both install and probe fail', async () => {
    const result = await ensurePostGis(
      makeClient(async (queryText) => {
        if (queryText.includes('CREATE EXTENSION')) {
          throw new Error('insufficient_privilege');
        }
        return { rows: [] };
      }),
    );
    expect(result.available).toBe(false);
    expect(result.reason).toContain('insufficient_privilege');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. Coverage smoke — confirm the schema barrel export surface stays
//    stable.
// ─────────────────────────────────────────────────────────────────────

describe('schema barrel export surface', () => {
  it('exposes every per-type extension table', () => {
    expect(entityExtLand).toBeDefined();
    expect(entityExtBuilding).toBeDefined();
    expect(entityExtVehicle).toBeDefined();
    expect(entityExtMachinery).toBeDefined();
    expect(entityExtItAsset).toBeDefined();
    expect(entityExtPerson).toBeDefined();
  });

  it('Row types compile (no-op runtime assertion)', () => {
    const row: CoreEntityRow | undefined = undefined;
    const type: EntityTypeDefinitionRow | undefined = undefined;
    const ext: TenantSchemaExtensionRow | undefined = undefined;
    expect(row).toBeUndefined();
    expect(type).toBeUndefined();
    expect(ext).toBeUndefined();
  });
});
