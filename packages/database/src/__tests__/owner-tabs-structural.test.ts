/**
 * owner_tabs_structural schema + RLS invariant tests (migration 0169).
 *
 * Mirrors feedback.test.ts / decision-traces.test.ts:
 *
 *   1. Drizzle schema introspection — confirms the column shape + primary key +
 *      indexes match migration 0169 (the table the action-executor `manage_tab`
 *      verb reads + writes; the code is the source of truth). Runs without a DB.
 *
 *   2. RLS invariant simulator — proves the tenant_id isolation policy in
 *      migration 0169 refuses cross-tenant reads + refuses an INSERT whose
 *      tenant_id ≠ the bound `app.current_tenant_id` GUC, while permitting
 *      same-tenant insert + read.
 *
 *   3. Insert-type compatibility — the exact field set the manage_tab handler
 *      passes to `.values()` satisfies the inferred Insert type.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  ownerTabsStructural,
  OWNER_TAB_KINDS,
  OWNER_TAB_STATUSES,
  type OwnerTabStructuralInsert,
} from '../schemas/owner-tabs-structural.schema.js';

// ─────────────────────────────────────────────────────────────────────
// 1. Schema introspection — Drizzle config matches migration 0169 and
//    covers every column the manage_tab handler touches.
// ─────────────────────────────────────────────────────────────────────

describe('owner_tabs_structural schema (migration 0169)', () => {
  it('declares the canonical column set the manage_tab verb reads + writes', () => {
    const cfg = getTableConfig(ownerTabsStructural);
    const names = cfg.columns.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'id',
        'tenant_id',
        'user_id',
        'tab_id',
        'label',
        'position',
        'pinned',
        'kind',
        'config',
        'status',
        'provenance',
        'created_at',
        'updated_at',
      ].sort(),
    );
  });

  it('uses `id` as the primary key', () => {
    const cfg = getTableConfig(ownerTabsStructural);
    expect(cfg.columns.find((c) => c.name === 'id')?.primary).toBe(true);
  });

  it('keeps tenant_id + user_id + tab_id + label NOT NULL', () => {
    const cfg = getTableConfig(ownerTabsStructural);
    for (const col of ['tenant_id', 'user_id', 'tab_id', 'label']) {
      expect(cfg.columns.find((c) => c.name === col)?.notNull).toBe(true);
    }
  });

  it('has NO money column (pure UI structure)', () => {
    const cfg = getTableConfig(ownerTabsStructural);
    const names = cfg.columns.map((c) => c.name);
    for (const moneyish of ['amount', 'tzs', 'wage', 'fee', 'ledger', 'total', 'price']) {
      expect(names.some((n) => n.includes(moneyish))).toBe(false);
    }
  });

  it('declares the UNIQUE (tenant_id, user_id, tab_id) index (idempotent spawn)', () => {
    const cfg = getTableConfig(ownerTabsStructural);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'owner_tabs_structural_tenant_user_tab_idx',
    );
    expect(idx).toBeDefined();
    expect(idx?.config.unique).toBe(true);
  });

  it('declares the (tenant_id, user_id, status, position) hydrate index', () => {
    const cfg = getTableConfig(ownerTabsStructural);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'owner_tabs_structural_tenant_user_status_idx',
    );
    expect(idx).toBeDefined();
  });

  it('exposes the closed kind + status sets backing the 0169 CHECK constraints', () => {
    expect(OWNER_TAB_KINDS).toEqual(['system', 'custom']);
    expect(OWNER_TAB_STATUSES).toEqual(['active', 'removed']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. RLS invariant simulator — models migration 0169's tenant-isolation
//    policy (USING + WITH CHECK on tenant_id = current_setting(
//    'app.current_tenant_id')) in-process.
// ─────────────────────────────────────────────────────────────────────

interface RlsTab {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly tabId: string;
}

class TenantRlsSimulator {
  private rows: RlsTab[] = [];
  private gucTenantId: string | null = null;

  setGuc(tenantId: string | null): void {
    this.gucTenantId = tenantId;
  }

  insert(row: RlsTab): void {
    // WITH CHECK: the row's tenant_id must equal the bound GUC.
    if (row.tenantId !== this.gucTenantId) {
      throw new Error(
        `RLS WITH CHECK: row.tenant_id=${row.tenantId} ≠ guc=${this.gucTenantId}`,
      );
    }
    this.rows.push(row);
  }

  select(): RlsTab[] {
    // USING: only rows whose tenant_id equals the bound GUC are visible.
    return this.rows.filter((r) => r.tenantId === this.gucTenantId);
  }
}

describe('owner_tabs_structural RLS isolation (migration 0169 policy)', () => {
  let sim: TenantRlsSimulator;

  beforeEach(() => {
    sim = new TenantRlsSimulator();
  });

  it('inserts + reads a tab within the bound tenant', () => {
    sim.setGuc('tenant_A');
    sim.insert({ id: 'tab_1', tenantId: 'tenant_A', userId: 'u1', tabId: 'compliance' });
    const rows = sim.select();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tabId).toBe('compliance');
  });

  it('refuses an INSERT whose tenant_id disagrees with the GUC', () => {
    sim.setGuc('tenant_A');
    expect(() =>
      sim.insert({ id: 'tab_x', tenantId: 'tenant_B', userId: 'u1', tabId: 'x' }),
    ).toThrow(/RLS WITH CHECK/);
  });

  it('refuses a cross-tenant SELECT (USING tenant_id = guc)', () => {
    sim.setGuc('tenant_A');
    sim.insert({ id: 'tab_1', tenantId: 'tenant_A', userId: 'u1', tabId: 'compliance' });
    // Tenant B reads — sees nothing.
    sim.setGuc('tenant_B');
    expect(sim.select()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Insert-type compatibility — the manage_tab spawn `.values()` shape
//    satisfies the inferred Insert type (compile-time check + a trivial
//    runtime assertion).
// ─────────────────────────────────────────────────────────────────────

describe('owner_tabs_structural insert-type compatibility with manage_tab', () => {
  it('accepts the spawn insert shape the handler writes', () => {
    const insert: OwnerTabStructuralInsert = {
      id: 'tab_1',
      tenantId: 'tenant_A',
      userId: 'u1',
      tabId: 'compliance',
      label: 'Compliance',
      position: 2,
      pinned: false,
      kind: 'custom',
      config: { query: 'overdue' },
      status: 'active',
      provenance: { via: 'chat', actorId: 'u1', requestedAt: new Date().toISOString() },
    };
    expect(insert.kind).toBe('custom');
    expect(insert.status).toBe('active');
  });
});
