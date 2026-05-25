/**
 * section_layouts schema + RLS invariant tests.
 *
 * Two test groups:
 *
 *   1. Drizzle schema introspection — confirms the column shape,
 *      composite primary key, and index declarations match the
 *      migration's expectation. Runs without a database.
 *
 *   2. RLS invariant simulator — mirrors the pattern from
 *      `rls-guc-bind.test.ts`. Proves the (tenant_id, user_id, route)
 *      isolation policy refuses cross-tenant reads and refuses an
 *      INSERT whose row.tenant_id ≠ GUC tenant_id.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  sectionLayouts,
  type SectionLayoutRow,
} from '../schemas/section-layouts.schema.js';

// ─────────────────────────────────────────────────────────────────────
// 1. Schema introspection — Drizzle config matches migration 0182.
// ─────────────────────────────────────────────────────────────────────

describe('section_layouts schema (migration 0182)', () => {
  it('declares the canonical column set', () => {
    const cfg = getTableConfig(sectionLayouts);
    const names = cfg.columns.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'tenant_id',
        'user_id',
        'route',
        'section_order',
        'pinned',
        'hidden',
        'metadata',
        'last_updated',
        'created_at',
      ].sort(),
    );
  });

  it('uses (tenant_id, user_id, route) as composite primary key', () => {
    const cfg = getTableConfig(sectionLayouts);
    const pk = cfg.primaryKeys[0];
    expect(pk).toBeDefined();
    const cols = pk?.columns.map((c) => c.name);
    expect(cols).toEqual(['tenant_id', 'user_id', 'route']);
  });

  it('declares (tenant_id, route) index for cross-user tenant analytics', () => {
    const cfg = getTableConfig(sectionLayouts);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'section_layouts_tenant_route_idx',
    );
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['tenant_id', 'route']);
  });

  it('declares (tenant_id, user_id, last_updated) index for consolidation sweeps', () => {
    const cfg = getTableConfig(sectionLayouts);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'section_layouts_tenant_user_updated_idx',
    );
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['tenant_id', 'user_id', 'last_updated']);
  });

  it('Row + Insert types are exported', () => {
    // Compile-time check — if the types are wrong, this file will
    // not type-check. At runtime, we just confirm the table is a
    // non-undefined value so the import resolved.
    const row: SectionLayoutRow | undefined = undefined;
    expect(sectionLayouts).toBeDefined();
    expect(row).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. RLS invariant simulator.
//    Mirrors `rls-guc-bind.test.ts` — no live Postgres in CI; we model
//    the (tenant_id, user_id, route) tenant-isolation pattern in an
//    in-process simulator.
// ─────────────────────────────────────────────────────────────────────

interface LayoutRow {
  readonly tenantId: string;
  readonly userId: string;
  readonly route: string;
  readonly sectionOrder: readonly string[];
}

class SectionLayoutsSim {
  private currentTxId: string | null = null;
  private currentTxGuc: string | null = null;
  private readonly rows: LayoutRow[] = [];
  private autoTxCounter = 0;

  begin(): void {
    if (this.currentTxId) throw new Error('tx already in progress');
    this.autoTxCounter += 1;
    this.currentTxId = `tx-${this.autoTxCounter}`;
    this.currentTxGuc = null;
  }

  commit(): void {
    if (!this.currentTxId) throw new Error('no tx');
    this.currentTxId = null;
    this.currentTxGuc = null;
  }

  setLocalTenantId(tenantId: string): void {
    if (!this.currentTxId) throw new Error('SET LOCAL needs tx');
    this.currentTxGuc = tenantId;
  }

  /** INSERT — RLS WITH CHECK predicate. */
  insert(row: LayoutRow): void {
    if (!this.currentTxId) throw new Error('INSERT needs tx');
    if (this.currentTxGuc !== row.tenantId) {
      throw new Error(
        `RLS WITH CHECK failed: GUC=${this.currentTxGuc ?? 'NULL'} != row.tenant_id=${row.tenantId}`,
      );
    }
    this.rows.push(row);
  }

  /** SELECT — tenant_isolation_select policy. */
  selectAll(): readonly LayoutRow[] {
    if (!this.currentTxId) throw new Error('SELECT needs tx');
    if (!this.currentTxGuc) return [];
    return this.rows.filter((r) => r.tenantId === this.currentTxGuc);
  }
}

const TENANT_A = '00000000-0000-0000-0000-00000000aaaa';
const TENANT_B = '00000000-0000-0000-0000-00000000bbbb';
const USER_X = 'user-x';
const USER_Y = 'user-y';

describe('section_layouts RLS invariants', () => {
  let sim: SectionLayoutsSim;

  beforeEach(() => {
    sim = new SectionLayoutsSim();
  });

  it('RLS prevents cross-tenant SELECT of section_layouts rows', () => {
    // TX1 — Tenant A's user inserts a layout row.
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    sim.insert({
      tenantId: TENANT_A,
      userId: USER_X,
      route: 'owner.dashboard',
      sectionOrder: ['payments', 'reports'],
    });
    sim.commit();

    // TX2 — Tenant B reads on the same pooled connection.
    sim.begin();
    sim.setLocalTenantId(TENANT_B);
    const tenantBView = sim.selectAll();
    sim.commit();

    // Tenant B sees nothing of Tenant A's layout.
    expect(tenantBView).toHaveLength(0);
  });

  it('RLS WITH CHECK refuses an INSERT whose row.tenant_id ≠ GUC tenant_id', () => {
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    expect(() =>
      sim.insert({
        tenantId: TENANT_B,
        userId: USER_X,
        route: 'owner.dashboard',
        sectionOrder: ['x'],
      }),
    ).toThrow(/RLS WITH CHECK failed/);
    sim.commit();
  });

  it('two tenants each see only their own users layouts on the same connection', () => {
    // Tenant A user X.
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    sim.insert({
      tenantId: TENANT_A,
      userId: USER_X,
      route: 'owner.dashboard',
      sectionOrder: ['a'],
    });
    sim.commit();

    // Tenant B user Y.
    sim.begin();
    sim.setLocalTenantId(TENANT_B);
    sim.insert({
      tenantId: TENANT_B,
      userId: USER_Y,
      route: 'owner.dashboard',
      sectionOrder: ['b'],
    });
    const bView = sim.selectAll();
    sim.commit();

    // Tenant A reads back.
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    const aView = sim.selectAll();
    sim.commit();

    expect(aView.map((r) => r.userId)).toEqual([USER_X]);
    expect(bView.map((r) => r.userId)).toEqual([USER_Y]);
  });

  it('SELECT without prior SET LOCAL returns zero rows (fail-closed)', () => {
    sim.begin();
    sim.setLocalTenantId(TENANT_A);
    sim.insert({
      tenantId: TENANT_A,
      userId: USER_X,
      route: 'owner.dashboard',
      sectionOrder: ['a'],
    });
    sim.commit();

    sim.begin();
    // No SET LOCAL — GUC is NULL — RLS denies all.
    const rows = sim.selectAll();
    sim.commit();
    expect(rows).toEqual([]);
  });
});
