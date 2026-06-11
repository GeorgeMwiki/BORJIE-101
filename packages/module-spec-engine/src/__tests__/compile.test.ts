/**
 * compile.test.ts — exercises the deterministic spec→SQL compiler.
 *
 * The contract these tests pin down:
 *
 *   * The compiler is pure: same input → same output (cache key
 *     correctness).
 *   * Every generated CREATE TABLE has a tenant_id + module_id column
 *     and is wrapped in IF NOT EXISTS.
 *   * Money fields are NEVER emitted as columns — they show up as a
 *     comment marker; the actual transaction must route through
 *     LedgerService.post().
 *   * The compiler refuses unsafe tenantId.
 *   * Enum fields produce a plain TEXT column (NO author CHECK — the
 *     ddl-guard forbids author CHECK; runtime Zod enforces membership).
 *   * The compiler emits NO RLS — RLS is injected + verified by the
 *     orchestrator. The compiler returns the bare tenant table names so
 *     the orchestrator can build the canonical FORCE-RLS block.
 */

import { describe, it, expect } from 'vitest';
import { compileSpec } from '../compile.js';
import { validateSpec } from '../validate.js';
import type { ModuleSpec } from '../types.js';

const hrSpec: ModuleSpec = {
  entities: [
    {
      slug: 'employee',
      display_name_en: 'Employee',
      display_name_sw: 'Mfanyakazi',
      fields: [
        { name: 'employee_number', kind: 'text', required: true, max_length: 32, index: true },
        { name: 'monthly_salary', kind: 'money', required: false },
        { name: 'department_id', kind: 'fk', required: true, references: 'department' },
        { name: 'status', kind: 'enum', required: true, values: ['active', 'leave', 'terminated'] },
      ],
    },
    {
      slug: 'department',
      display_name_en: 'Department',
      fields: [{ name: 'name', kind: 'text', required: true }],
    },
  ],
  workflows: [],
  ui_sections: [{ kind: 'form', entity: 'employee' }],
};

describe('compileSpec — output structure', () => {
  it('returns ok=true for a valid spec', () => {
    const r = compileSpec(hrSpec, 'tnt_test');
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.migrationSql.length).toBeGreaterThan(0);
  });

  it('emits a CREATE TABLE for every declared entity (canonical tenant_mod_ prefix)', () => {
    const r = compileSpec(hrSpec, 'tnt_test');
    expect(r.migrationSql).toContain('CREATE TABLE IF NOT EXISTS tenant_mod_tnt_test_employee');
    expect(r.migrationSql).toContain('CREATE TABLE IF NOT EXISTS tenant_mod_tnt_test_department');
    // Legacy module_ prefix must be gone.
    expect(r.migrationSql).not.toContain('CREATE TABLE IF NOT EXISTS module_tnt_test_');
  });

  it('returns the bare tenant table names it created', () => {
    const r = compileSpec(hrSpec, 'tnt_test');
    expect(r.tableNames).toEqual([
      'tenant_mod_tnt_test_employee',
      'tenant_mod_tnt_test_department',
    ]);
  });

  it('every generated table carries tenant_id + module_id', () => {
    const r = compileSpec(hrSpec, 'tnt_test');
    // Two entities → 2 tenant_id columns + 2 module_id columns expected.
    const tenantMatches = r.migrationSql.match(/tenant_id\s+TEXT NOT NULL REFERENCES tenants/g);
    const moduleMatches = r.migrationSql.match(/module_id\s+TEXT NOT NULL REFERENCES modules/g);
    expect(tenantMatches?.length).toBe(2);
    expect(moduleMatches?.length).toBe(2);
  });

  it('NEVER emits a column for a money field', () => {
    const r = compileSpec(hrSpec, 'tnt_test');
    // No "monthly_salary VARCHAR" / "monthly_salary NUMERIC" / etc.
    expect(r.migrationSql).not.toMatch(/monthly_salary\s+(VARCHAR|NUMERIC|INTEGER|TEXT NOT NULL)/);
    // But DOES emit a comment marker.
    expect(r.migrationSql).toMatch(/money field 'monthly_salary'/);
    expect(r.migrationSql).toMatch(/LedgerService\.post\(\)/);
  });

  it('emits a plain TEXT column for enum fields (NO author CHECK)', () => {
    const r = compileSpec(hrSpec, 'tnt_test');
    expect(r.migrationSql).toMatch(/status\s+TEXT NOT NULL/);
    // The compiler must NOT emit an author CHECK — the ddl-guard forbids
    // it; runtime Zod enforces the closed enum value set instead.
    expect(r.migrationSql).not.toMatch(/CHECK\s*\(status IN/);
  });

  it('emits NO RLS — RLS is the orchestrator’s responsibility', () => {
    const r = compileSpec(hrSpec, 'tnt_test');
    expect(r.migrationSql).not.toMatch(/ROW LEVEL SECURITY/);
    expect(r.migrationSql).not.toMatch(/CREATE POLICY/);
    expect(r.migrationSql).not.toMatch(/REVOKE/);
    expect(r.migrationSql).not.toMatch(/current_app_tenant_id/);
    expect(r.migrationSql).not.toMatch(/DO \$/);
  });

  it('emits Zod-validator trees keyed by entity slug', () => {
    const r = compileSpec(hrSpec, 'tnt_test');
    expect(r.zodValidators.employee).toBeDefined();
    expect(r.zodValidators.department).toBeDefined();
    expect(r.zodValidators.employee?.fields.status?.kind).toBe('enum');
    expect(r.zodValidators.employee?.fields.status?.values).toEqual([
      'active',
      'leave',
      'terminated',
    ]);
  });
});

describe('compileSpec — determinism', () => {
  it('same input → bit-identical output (cache key correctness)', () => {
    const a = compileSpec(hrSpec, 'tnt_test');
    const b = compileSpec(hrSpec, 'tnt_test');
    expect(a.migrationSql).toBe(b.migrationSql);
    expect(JSON.stringify(a.zodValidators)).toBe(JSON.stringify(b.zodValidators));
  });
});

describe('compileSpec — safety', () => {
  it('refuses an unsafe tenantId containing a semicolon', () => {
    const r = compileSpec(hrSpec, "tnt_; DROP TABLE tenants; --");
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/unsafe tenantId/);
  });

  it('refuses an unsafe tenantId starting with a digit', () => {
    const r = compileSpec(hrSpec, '1evil');
    expect(r.ok).toBe(false);
  });

  it('refuses an invalid spec (defence in depth — caller should validate first)', () => {
    const bad: any = { entities: [], workflows: [], ui_sections: [] };
    const r = compileSpec(bad, 'tnt_test');
    expect(r.ok).toBe(false);
  });
});

describe('compileSpec — ui layout', () => {
  it('builds a structured layout object', () => {
    const r = compileSpec(hrSpec, 'tnt_test');
    expect(r.uiLayout.sections.length).toBe(1);
    expect(r.uiLayout.sections[0]).toMatchObject({
      kind: 'form',
      entity: 'employee',
    });
  });
});

describe('validateSpec → compileSpec integration', () => {
  it('rejects then refuses to compile a spec with FK to unknown entity', () => {
    const bad: ModuleSpec = {
      entities: [
        {
          slug: 'employee',
          display_name_en: 'Employee',
          fields: [
            { name: 'dept', kind: 'fk', required: true, references: 'ghost' },
          ],
        },
      ],
      workflows: [],
      ui_sections: [],
    };
    expect(validateSpec(bad).ok).toBe(false);
    expect(compileSpec(bad, 'tnt_test').ok).toBe(false);
  });
});
