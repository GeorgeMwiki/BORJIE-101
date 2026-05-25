/**
 * validate.test.ts — exercises the grammar enforcement that gates
 * every LLM-emitted spec before any compiler runs.
 */

import { describe, it, expect } from 'vitest';
import { validateSpec } from '../validate.js';
import type { ModuleSpec } from '../types.js';

const validSpec: ModuleSpec = {
  entities: [
    {
      slug: 'employee',
      display_name_en: 'Employee',
      display_name_sw: 'Mfanyakazi',
      fields: [
        { name: 'employee_number', kind: 'text', required: true, max_length: 32, index: true },
        { name: 'status', kind: 'enum', required: true, values: ['active', 'leave', 'terminated'] },
      ],
    },
    {
      slug: 'department',
      display_name_en: 'Department',
      fields: [{ name: 'name', kind: 'text', required: true }],
    },
  ],
  workflows: [
    {
      slug: 'onboard',
      title: 'Onboard new employee',
      trigger_entity: 'employee',
      trigger_event: 'create',
      steps: ['validate_nida', 'issue_pack'],
    },
  ],
  ui_sections: [
    {
      kind: 'table',
      entity: 'employee',
      columns: ['employee_number', 'display_name', 'status'],
    },
    { kind: 'form', entity: 'employee' },
    { kind: 'kpi_tile', title: 'Active staff', query: 'count(employee where status=active)' },
  ],
};

describe('validateSpec — happy path', () => {
  it('accepts a clean spec', () => {
    const result = validateSpec(validSpec);
    expect(result.ok).toBe(true);
    expect(result.spec).toBeDefined();
    expect(result.errors).toEqual([]);
  });
});

describe('validateSpec — grammar violations', () => {
  it('rejects empty entities array', () => {
    const r = validateSpec({ entities: [], workflows: [], ui_sections: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('rejects an entity slug containing punctuation (SQL injection probe)', () => {
    const malicious = {
      ...validSpec,
      entities: [
        {
          slug: "employee;DROP TABLE",
          display_name_en: 'pwned',
          fields: [{ name: 'x', kind: 'text', required: true }],
        },
      ],
    };
    const r = validateSpec(malicious);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/slug/);
  });

  it('rejects a field name with hyphens (SQL identifier injection probe)', () => {
    const bad = {
      ...validSpec,
      entities: [
        {
          slug: 'employee',
          display_name_en: 'Employee',
          fields: [{ name: 'monthly-salary', kind: 'text', required: true }],
        },
      ],
    };
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/slug|name/);
  });

  it('rejects an enum value with whitespace', () => {
    const bad = {
      ...validSpec,
      entities: [
        {
          slug: 'employee',
          display_name_en: 'Employee',
          fields: [
            { name: 'status', kind: 'enum', required: true, values: ['active staff'] },
          ],
        },
      ],
    };
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
  });

  it('rejects an FK that references an unknown entity', () => {
    const bad = {
      ...validSpec,
      entities: [
        {
          slug: 'employee',
          display_name_en: 'Employee',
          fields: [
            { name: 'department_id', kind: 'fk', required: true, references: 'ghost' },
          ],
        },
      ],
      ui_sections: [{ kind: 'form', entity: 'employee' }],
    };
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/references unknown entity/);
  });

  it('rejects a UI table that references a non-existent column', () => {
    const bad = {
      ...validSpec,
      ui_sections: [
        { kind: 'table', entity: 'employee', columns: ['employee_number', 'monthly_salary'] },
      ],
    };
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/not present on entity/);
  });

  it('rejects duplicate entity slugs', () => {
    const bad = {
      ...validSpec,
      entities: [
        validSpec.entities[0]!,
        validSpec.entities[0]!,
      ],
    };
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/duplicate entity slug/);
  });

  it('rejects duplicate field names within an entity', () => {
    const bad = {
      ...validSpec,
      entities: [
        {
          slug: 'employee',
          display_name_en: 'E',
          fields: [
            { name: 'foo', kind: 'text', required: true },
            { name: 'foo', kind: 'int', required: false },
          ],
        },
      ],
      workflows: [],
      ui_sections: [],
    };
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/duplicate field/);
  });

  it('rejects a workflow trigger_entity not in entities and not a built-in', () => {
    const bad = {
      ...validSpec,
      workflows: [
        {
          slug: 'wf',
          title: 'wf',
          trigger_entity: 'ghost',
          trigger_event: 'create' as const,
          steps: ['s1'],
        },
      ],
    };
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/trigger_entity/);
  });

  it('accepts the built-in trigger entity "time"', () => {
    const ok = {
      ...validSpec,
      workflows: [
        {
          slug: 'wf',
          title: 'wf',
          trigger_entity: 'time',
          trigger_event: 'time' as const,
          steps: ['s1'],
        },
      ],
    };
    const r = validateSpec(ok);
    expect(r.ok).toBe(true);
  });

  it('rejects non-object input', () => {
    expect(validateSpec('hi').ok).toBe(false);
    expect(validateSpec(null).ok).toBe(false);
    expect(validateSpec(42).ok).toBe(false);
  });

  it('rejects spec missing required top-level keys', () => {
    expect(validateSpec({ entities: [] }).ok).toBe(false);
    expect(validateSpec({}).ok).toBe(false);
  });
});
