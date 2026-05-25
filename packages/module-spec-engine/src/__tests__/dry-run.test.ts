/**
 * dry-run.test.ts — pin down the previewMigration + diffCompileResults
 * surfaces. These power the `/spec/preview` endpoint and the K5
 * reviewer's diff-of-changes UI.
 */

import { describe, it, expect } from 'vitest';
import { previewMigration, diffCompileResults } from '../dry-run.js';
import { compileSpec } from '../compile.js';
import type { ModuleSpec } from '../types.js';

const baseSpec: ModuleSpec = {
  entities: [
    {
      slug: 'employee',
      display_name_en: 'Employee',
      fields: [
        { name: 'employee_number', kind: 'text', required: true },
        { name: 'monthly_salary', kind: 'money', required: false },
      ],
    },
  ],
  workflows: [],
  ui_sections: [],
};

describe('previewMigration', () => {
  it('returns counts and SQL without touching any DB', () => {
    const r = previewMigration(baseSpec, 'tnt_test');
    expect(r.ok).toBe(true);
    expect(r.tableCount).toBe(1);
    expect(r.workflowCount).toBe(0);
    expect(r.uiSectionCount).toBe(0);
    expect(r.moneyFieldCount).toBe(1);
    expect(r.migrationSql).toContain('CREATE TABLE');
  });
});

describe('diffCompileResults', () => {
  it('reports added tables when entities grow', () => {
    const before = compileSpec(baseSpec, 'tnt_test');
    const grown: ModuleSpec = {
      ...baseSpec,
      entities: [
        ...baseSpec.entities,
        {
          slug: 'department',
          display_name_en: 'Department',
          fields: [{ name: 'name', kind: 'text', required: true }],
        },
      ],
    };
    const after = compileSpec(grown, 'tnt_test');
    const diff = diffCompileResults(before, after);
    expect(diff.addedTables).toContain('module_tnt_test_department');
    expect(diff.removedTables).toEqual([]);
  });

  it('reports removed tables when entities shrink', () => {
    const before = compileSpec(
      {
        ...baseSpec,
        entities: [
          ...baseSpec.entities,
          {
            slug: 'temp',
            display_name_en: 'Temp',
            fields: [{ name: 'name', kind: 'text', required: true }],
          },
        ],
      },
      'tnt_test',
    );
    const after = compileSpec(baseSpec, 'tnt_test');
    const diff = diffCompileResults(before, after);
    expect(diff.removedTables).toContain('module_tnt_test_temp');
  });

  it('flags a changed table when a field is added', () => {
    const before = compileSpec(baseSpec, 'tnt_test');
    const changed: ModuleSpec = {
      ...baseSpec,
      entities: [
        {
          ...baseSpec.entities[0]!,
          fields: [
            ...baseSpec.entities[0]!.fields,
            { name: 'is_remote', kind: 'boolean', required: false },
          ],
        },
      ],
    };
    const after = compileSpec(changed, 'tnt_test');
    const diff = diffCompileResults(before, after);
    expect(diff.changedTables).toContain('module_tnt_test_employee');
  });
});
