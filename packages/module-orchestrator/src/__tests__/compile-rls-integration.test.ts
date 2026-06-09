/**
 * compile-rls-integration.test.ts — the Pass-2 contract seam.
 *
 * Proves the compiler (which emits NO RLS) + the orchestrator's
 * `buildCanonicalRlsBlock` (the ONLY RLS source) combine into DDL that
 * passes BOTH the allowlist validator (HARD RULE 1) and the per-table
 * FORCE-RLS coverage check (HARD RULE 2). This is the exact join the
 * orchestrator's `persistModuleAndSpec` performs.
 */

import { describe, it, expect } from 'vitest';
import { compileSpec, type ModuleSpec } from '@borjie/module-spec-engine';
import {
  buildCanonicalRlsBlock,
  validateGeneratedDdl,
  verifyRlsForced,
} from '../ddl-guard/index.js';
import { hrBundle } from '@borjie/module-templates';

const TENANT = 'acme_mining';

const simpleSpec: ModuleSpec = {
  entities: [
    {
      slug: 'assay',
      display_name_en: 'Assay',
      fields: [
        { name: 'sample_ref', kind: 'text', required: true, max_length: 120, index: true },
        { name: 'grade_pct', kind: 'numeric', required: false, precision: 18, scale: 4 },
        { name: 'assayed', kind: 'boolean', required: true },
        { name: 'status', kind: 'enum', required: true, values: ['draft', 'assayed', 'shipped'] },
      ],
    },
  ],
  workflows: [],
  ui_sections: [],
};

describe('compileSpec + buildCanonicalRlsBlock → validateGeneratedDdl', () => {
  it('the joined DDL passes the allowlist validator and RLS-forced coverage', () => {
    const compiled = compileSpec(simpleSpec, TENANT);
    expect(compiled.ok).toBe(true);
    expect(compiled.tableNames).toEqual(['tenant_mod_acme_mining_assay']);

    const rls = buildCanonicalRlsBlock(TENANT, compiled.tableNames);
    const finalSql = `${compiled.migrationSql}\n\n${rls}`;

    const v = validateGeneratedDdl({ tenantId: TENANT, migrationSql: finalSql });
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.createdTables).toEqual(['tenant_mod_acme_mining_assay']);

    const rlsForced = verifyRlsForced(finalSql, compiled.tableNames, TENANT);
    expect(rlsForced.ok).toBe(true);
  });

  it('the bare compiler body (no RLS) is REJECTED by the validator (HARD RULE 2)', () => {
    const compiled = compileSpec(simpleSpec, TENANT);
    const v = validateGeneratedDdl({
      tenantId: TENANT,
      migrationSql: compiled.migrationSql,
    });
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/RLS|ROW LEVEL SECURITY|FORCE/i);
  });

  it('the real HR template bundle compiles + RLS-injects to valid DDL', () => {
    const compiled = compileSpec(hrBundle.spec as ModuleSpec, TENANT);
    expect(compiled.ok).toBe(true);
    const finalSql = `${compiled.migrationSql}\n\n${buildCanonicalRlsBlock(
      TENANT,
      compiled.tableNames,
    )}`;
    const v = validateGeneratedDdl({ tenantId: TENANT, migrationSql: finalSql });
    expect(v.ok).toBe(true);
    expect(v.createdTables.length).toBe(compiled.tableNames.length);
  });
});
