/**
 * portal_tabs schema + RLS invariant tests (migration 0170).
 *
 * The `portal_tabs` table is the durable store for MD-authored dynamic tabs
 * (the "infinite dynamic tabs" feature). The portal-genui engine's Drizzle
 * adapter (`packages/portal-genui/src/persistence/drizzle-tab-repo.ts`) speaks
 * plain parameterised SQL against these exact columns — the adapter is the
 * source of truth, so this test locks the Drizzle schema + migration in sync
 * with it.
 *
 * Three groups, mirroring feedback.test.ts:
 *   1. Schema introspection — Drizzle column shape matches migration 0170 and
 *      the adapter's SQL (id, tenant_id, user_id, tab_key, schema_version, tab,
 *      parent_tab_id, created_at, updated_at). Runs without a database.
 *   2. RLS invariant simulator — models migration 0170's tenant-isolation
 *      policy (USING + WITH CHECK on tenant_id = GUC): same-tenant insert+read,
 *      cross-tenant denial, WITH CHECK rejection on tenant mismatch.
 *   3. Migration SQL assertions — the shipped 0170 file FORCEs RLS, scopes the
 *      policy to app.current_tenant_id, declares UNIQUE(tenant_id, tab_key), and
 *      is anon-guarded + forward-only (mirrors 0164).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it, beforeEach } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  portalTabs,
  type PortalTabRow,
  type NewPortalTabRow,
} from '../schemas/portal-tabs.schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(
  __dirname,
  '..',
  'migrations',
  '0170_portal_tabs.sql',
);

// ─────────────────────────────────────────────────────────────────────
// 1. Schema introspection — matches migration 0170 + the adapter's SQL.
// ─────────────────────────────────────────────────────────────────────

describe('portal_tabs schema (migration 0170)', () => {
  it('declares the canonical column set the adapter reads + writes', () => {
    const cfg = getTableConfig(portalTabs);
    const names = cfg.columns.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'id',
        'tenant_id',
        'user_id',
        'tab_key',
        'schema_version',
        'tab',
        'parent_tab_id',
        'created_at',
        'updated_at',
      ].sort(),
    );
  });

  it('uses `id` as the primary key', () => {
    const cfg = getTableConfig(portalTabs);
    expect(cfg.columns.find((c) => c.name === 'id')?.primary).toBe(true);
  });

  it('keeps tenant_id + tab_key NOT NULL (RLS scope + routing key)', () => {
    const cfg = getTableConfig(portalTabs);
    expect(cfg.columns.find((c) => c.name === 'tenant_id')?.notNull).toBe(true);
    expect(cfg.columns.find((c) => c.name === 'tab_key')?.notNull).toBe(true);
  });

  it('allows user_id to be NULL (tenant-default tabs)', () => {
    const cfg = getTableConfig(portalTabs);
    expect(cfg.columns.find((c) => c.name === 'user_id')?.notNull).toBe(false);
  });

  it('stores the document in a NOT NULL jsonb `tab` column', () => {
    const cfg = getTableConfig(portalTabs);
    const tab = cfg.columns.find((c) => c.name === 'tab');
    expect(tab?.notNull).toBe(true);
    expect(tab?.getSQLType()).toBe('jsonb');
  });

  it('declares the UNIQUE(tenant_id, tab_key) index', () => {
    const cfg = getTableConfig(portalTabs);
    const uq = cfg.indexes.find(
      (i) => i.config.name === 'portal_tabs_tenant_tab_key_uq',
    );
    expect(uq).toBeDefined();
    expect(uq?.config.unique).toBe(true);
  });

  it('declares the (tenant_id, user_id) listing index', () => {
    const cfg = getTableConfig(portalTabs);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'portal_tabs_tenant_user_idx',
    );
    expect(idx).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. RLS invariant simulator — models migration 0170's tenant policy.
// ─────────────────────────────────────────────────────────────────────

interface RlsRow {
  readonly id: string;
  readonly tenantId: string;
  readonly tabKey: string;
}

class TenantRlsSimulator {
  private rows: RlsRow[] = [];
  private gucTenantId: string | null = null;

  setGuc(tenantId: string | null): void {
    this.gucTenantId = tenantId;
  }

  insert(row: RlsRow): void {
    // WITH CHECK: the row's tenant_id must equal the bound GUC.
    if (row.tenantId !== this.gucTenantId) {
      throw new Error(
        `RLS WITH CHECK: row.tenant_id=${row.tenantId} ≠ guc=${this.gucTenantId}`,
      );
    }
    this.rows.push(row);
  }

  select(): RlsRow[] {
    // USING: only rows whose tenant_id equals the bound GUC are visible.
    return this.rows.filter((r) => r.tenantId === this.gucTenantId);
  }
}

describe('portal_tabs RLS isolation (migration 0170 policy)', () => {
  let sim: TenantRlsSimulator;

  beforeEach(() => {
    sim = new TenantRlsSimulator();
  });

  it('inserts + reads a tab within the bound tenant', () => {
    sim.setGuc('tenant_A');
    sim.insert({ id: 'tab_1', tenantId: 'tenant_A', tabKey: 'hr.payroll' });
    const rows = sim.select();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('tab_1');
  });

  it('refuses an INSERT whose tenant_id disagrees with the GUC', () => {
    sim.setGuc('tenant_A');
    expect(() =>
      sim.insert({ id: 'tab_x', tenantId: 'tenant_B', tabKey: 'hr.payroll' }),
    ).toThrow(/RLS WITH CHECK/);
  });

  it('refuses a cross-tenant SELECT (USING tenant_id = guc)', () => {
    sim.setGuc('tenant_A');
    sim.insert({ id: 'tab_1', tenantId: 'tenant_A', tabKey: 'hr.payroll' });
    sim.setGuc('tenant_B');
    expect(sim.select()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Migration SQL assertions — the shipped 0170 honours the hard rules.
// ─────────────────────────────────────────────────────────────────────

describe('0170_portal_tabs.sql migration content', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  it('FORCE-enables row level security on portal_tabs', () => {
    expect(sql).toMatch(/ALTER TABLE public\.portal_tabs ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE public\.portal_tabs FORCE ROW LEVEL SECURITY/);
  });

  it('scopes the tenant policy to the app.current_tenant_id GUC', () => {
    expect(sql).toContain(
      "current_setting('app.current_tenant_id', true)",
    );
    // Never the legacy GUC.
    expect(sql).not.toContain("current_setting('app.tenant_id'");
  });

  it('declares UNIQUE(tenant_id, tab_key)', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS portal_tabs_tenant_tab_key_uq[\s\S]*\(tenant_id, tab_key\)/,
    );
  });

  it('is anon-guarded for vanilla Postgres / CI empty-PG', () => {
    expect(sql).toContain("pg_roles WHERE rolname = 'anon'");
    expect(sql).toContain('REVOKE ALL ON public.portal_tabs FROM anon');
  });

  it('is idempotent / forward-only (IF NOT EXISTS + policy existence guard)', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS portal_tabs');
    expect(sql).toContain('portal_tabs_tenant_isolation');
    expect(sql).toMatch(/IF NOT EXISTS \([\s\S]*pg_policies/);
  });

  it('carries no money columns (UI/forms document only)', () => {
    expect(sql).not.toMatch(/amount_minor|amount_cents|balance|currency_code/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Insert-type compatibility — the field set the adapter passes to the
//    INSERT must satisfy the inferred Insert/Select types (compile-time).
// ─────────────────────────────────────────────────────────────────────

describe('portal_tabs insert-type compatibility with the adapter', () => {
  it('accepts the adapter insert shape', () => {
    const insert: NewPortalTabRow = {
      id: 'tab_1',
      tenantId: 'tenant_A',
      userId: 'user_1',
      tabKey: 'hr.payroll',
      schemaVersion: 1,
      tab: { id: 'tab_1', title: 'Payroll' },
      parentTabId: null,
    };
    const row: PortalTabRow | undefined = undefined;
    expect(insert.tabKey).toBe('hr.payroll');
    expect(row).toBeUndefined();
  });
});
