/**
 * module-spawning registry schema + migration invariant tests (migration 0323).
 *
 * Three control-plane tables back the Piece B module-spawning control plane:
 *   - modules          (tenant-scoped registry)
 *   - module_specs     (tenant-scoped versioned compiled-spec + apply ledger)
 *   - module_templates (GLOBAL built-in catalogue, no tenant boundary)
 *
 * The Drizzle pgTable defs and the shipped migration 0323 must agree
 * byte-for-byte on snake_case column names + types. These tests lock that:
 *
 *   1. Schema introspection — Drizzle column shape (names + key NOT NULLs +
 *      jsonb types + the apply-proof CHECK + the UNIQUE indexes). Runs without
 *      a database.
 *   2. Migration SQL assertions — the shipped 0323 file FORCEs RLS, scopes the
 *      tenant policy to the canonical app.current_tenant_id GUC, declares the
 *      global read-all + service-role-only write split for module_templates,
 *      carries the apply-proof CHECK, is anon-guarded, and is fully idempotent.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  modules,
  type ModuleRow,
  type ModuleInsert,
} from '../schemas/modules/modules.schema.js';
import {
  moduleSpecs,
  type ModuleSpecRow,
  type ModuleSpecInsert,
} from '../schemas/modules/module-specs.schema.js';
import {
  moduleTemplates,
  type ModuleTemplateRow,
  type ModuleTemplateInsert,
} from '../schemas/modules/module-templates.schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(
  __dirname,
  '..',
  'migrations',
  '0323_module_spawning_registry.sql',
);
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, 'utf8');

// ─────────────────────────────────────────────────────────────────────
// Type-level smoke: the exported Row / Insert types are usable. (Compile-
// time only — keeps the imports load-bearing so a rename breaks the build.)
// ─────────────────────────────────────────────────────────────────────

const _moduleRow: Partial<ModuleRow> = {};
const _moduleInsert: ModuleInsert = {
  id: 'm1',
  tenantId: 't1',
  slug: 's',
  title: 'T',
  vectorNamespace: 'ns',
};
const _specRow: Partial<ModuleSpecRow> = {};
const _specInsert: ModuleSpecInsert = {
  id: 'sp1',
  moduleId: 'm1',
  tenantId: 't1',
  specJsonb: {},
  generatedMigrationSql: 'SELECT 1;',
};
const _tplRow: Partial<ModuleTemplateRow> = {};
const _tplInsert: ModuleTemplateInsert = {
  id: 'tpl1',
  slug: 's',
  titleEn: 'T',
  defaultSpec: {},
};
void _moduleRow;
void _moduleInsert;
void _specRow;
void _specInsert;
void _tplRow;
void _tplInsert;

// ─────────────────────────────────────────────────────────────────────
// 1. Schema introspection — Drizzle defs match migration 0323 columns.
// ─────────────────────────────────────────────────────────────────────

describe('modules schema (migration 0323)', () => {
  it('declares the canonical snake_case column set', () => {
    const names = getTableConfig(modules)
      .columns.map((c) => c.name)
      .sort();
    expect(names).toEqual(
      [
        'id',
        'tenant_id',
        'slug',
        'title',
        'title_sw',
        'template_id',
        'spec_id',
        'vector_namespace',
        'scoped_tool_ids',
        'lifecycle_state',
        'created_by_user_id',
        'created_at',
        'updated_at',
        'deleted_at',
      ].sort(),
    );
  });

  it('uses `id` as the primary key', () => {
    const cfg = getTableConfig(modules);
    expect(cfg.columns.find((c) => c.name === 'id')?.primary).toBe(true);
  });

  it('keeps tenant_id + slug + vector_namespace NOT NULL', () => {
    const cfg = getTableConfig(modules);
    for (const col of ['tenant_id', 'slug', 'vector_namespace']) {
      expect(cfg.columns.find((c) => c.name === col)?.notNull).toBe(true);
    }
  });

  it('stores scoped_tool_ids as a jsonb column', () => {
    const cfg = getTableConfig(modules);
    expect(
      cfg.columns.find((c) => c.name === 'scoped_tool_ids')?.getSQLType(),
    ).toBe('jsonb');
  });

  it('declares the UNIQUE(tenant_id, slug) spawn-idempotency index', () => {
    const cfg = getTableConfig(modules);
    const uq = cfg.indexes.find(
      (i) => i.config.name === 'modules_tenant_slug_uniq',
    );
    expect(uq).toBeDefined();
    expect(uq?.config.unique).toBe(true);
  });
});

describe('module_specs schema (migration 0323)', () => {
  it('declares the canonical snake_case column set', () => {
    const names = getTableConfig(moduleSpecs)
      .columns.map((c) => c.name)
      .sort();
    expect(names).toEqual(
      [
        'id',
        'module_id',
        'tenant_id',
        'version',
        'spec_jsonb',
        'generated_migration_sql',
        'generated_zod_validators',
        'status',
        'applied_migration_filename',
        'error',
        'created_at',
        'applied_at',
      ].sort(),
    );
  });

  it('keeps module_id + tenant_id + generated_migration_sql NOT NULL', () => {
    const cfg = getTableConfig(moduleSpecs);
    for (const col of ['module_id', 'tenant_id', 'generated_migration_sql']) {
      expect(cfg.columns.find((c) => c.name === col)?.notNull).toBe(true);
    }
  });

  it('declares the apply-proof CHECK constraint', () => {
    const cfg = getTableConfig(moduleSpecs);
    const chk = cfg.checks.find(
      (c) => c.name === 'module_specs_applied_proof_chk',
    );
    expect(chk).toBeDefined();
  });

  it('declares the (tenant_id, module_id) listing index', () => {
    const cfg = getTableConfig(moduleSpecs);
    expect(
      cfg.indexes.find((i) => i.config.name === 'idx_module_specs_tenant_module'),
    ).toBeDefined();
  });
});

describe('module_templates schema (migration 0323)', () => {
  it('declares the canonical snake_case column set (NO tenant_id — global)', () => {
    const names = getTableConfig(moduleTemplates)
      .columns.map((c) => c.name)
      .sort();
    expect(names).toEqual(
      ['id', 'slug', 'title_en', 'title_sw', 'default_spec', 'created_at'].sort(),
    );
    expect(names).not.toContain('tenant_id');
  });

  it('keeps slug + title_en + default_spec NOT NULL', () => {
    const cfg = getTableConfig(moduleTemplates);
    for (const col of ['slug', 'title_en', 'default_spec']) {
      expect(cfg.columns.find((c) => c.name === col)?.notNull).toBe(true);
    }
  });

  it('declares the global-unique slug index', () => {
    const cfg = getTableConfig(moduleTemplates);
    const uq = cfg.indexes.find(
      (i) => i.config.name === 'module_templates_slug_uniq',
    );
    expect(uq).toBeDefined();
    expect(uq?.config.unique).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Migration SQL invariants — RLS shape, CHECK, idempotency, anon guard.
// ─────────────────────────────────────────────────────────────────────

describe('migration 0323 SQL invariants', () => {
  it('creates all three tables idempotently (IF NOT EXISTS)', () => {
    for (const tbl of ['modules', 'module_specs', 'module_templates']) {
      expect(MIGRATION_SQL).toContain(`CREATE TABLE IF NOT EXISTS ${tbl}`);
    }
  });

  it('FORCEs row level security on every table', () => {
    expect(MIGRATION_SQL).toMatch(/modules.*FORCE\s+ROW\s+LEVEL\s+SECURITY/s);
    expect(MIGRATION_SQL).toContain(
      'ALTER TABLE module_templates FORCE  ROW LEVEL SECURITY',
    );
  });

  it('scopes the tenant policy to the canonical app.current_tenant_id GUC', () => {
    expect(MIGRATION_SQL).toContain(
      "current_setting(''app.current_tenant_id'', true)",
    );
    // Never the legacy GUC.
    expect(MIGRATION_SQL).not.toContain("current_setting(''app.tenant_id''");
  });

  it('installs the tenant_isolation_<tbl> loop policy + service-role bypass', () => {
    expect(MIGRATION_SQL).toContain("'tenant_isolation_' || tbl");
    expect(MIGRATION_SQL).toContain("tbl || '_service_role_bypass'");
    // The loop array shape the RLS-coverage scanner recognises.
    expect(MIGRATION_SQL).toMatch(/tenant_tables text\[\] := ARRAY\[/);
  });

  it('gives module_templates a read-all SELECT + service-role-only write split', () => {
    expect(MIGRATION_SQL).toContain('module_templates_read_all');
    expect(MIGRATION_SQL).toContain('FOR SELECT USING (true)');
    expect(MIGRATION_SQL).toContain('module_templates_service_write');
    expect(MIGRATION_SQL).toContain(
      "current_setting(''app.is_service_role'', true) = ''true''",
    );
  });

  it('carries the honest apply-proof CHECK', () => {
    expect(MIGRATION_SQL).toContain('module_specs_applied_proof_chk');
    expect(MIGRATION_SQL).toMatch(
      /status <> 'applied' OR applied_migration_filename IS NOT NULL/,
    );
  });

  it('guards the anon REVOKE behind a pg_roles existence check', () => {
    expect(MIGRATION_SQL).toContain(
      "SELECT 1 FROM pg_roles WHERE rolname = 'anon'",
    );
    expect(MIGRATION_SQL).toContain('REVOKE ALL ON public.module_templates FROM anon');
  });

  it('is forward-only (BEGIN/COMMIT, no destructive DROP TABLE)', () => {
    expect(MIGRATION_SQL).toContain('BEGIN;');
    expect(MIGRATION_SQL).toContain('COMMIT;');
    expect(MIGRATION_SQL).not.toMatch(/DROP\s+TABLE/i);
  });
});
