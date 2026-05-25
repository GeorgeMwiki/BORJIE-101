/**
 * compile-field-kinds.test.ts — exercise every FieldKind branch in the
 * compiler so the branch-coverage threshold (≥75%) is met.
 */

import { describe, it, expect } from 'vitest';
import { compileSpec } from '../compile.js';
import type { ModuleSpec } from '../types.js';

const allKindsSpec: ModuleSpec = {
  entities: [
    {
      slug: 'thing',
      display_name_en: 'Thing',
      fields: [
        { name: 'name', kind: 'text', required: true, max_length: 64 },
        { name: 'short_desc', kind: 'text', required: false },
        { name: 'qty', kind: 'int', required: true, min: 0, max: 100 },
        { name: 'qty_default', kind: 'int', required: false },
        { name: 'price', kind: 'numeric', required: true, precision: 12, scale: 2, min: 0, max: 999999 },
        { name: 'price_default', kind: 'numeric', required: false },
        { name: 'cost', kind: 'money', required: false, currency_field: 'tenant_default' },
        { name: 'live_from', kind: 'date', required: true },
        { name: 'live_from_optional', kind: 'date', required: false },
        { name: 'last_seen', kind: 'datetime', required: true },
        { name: 'last_seen_optional', kind: 'datetime', required: false },
        { name: 'is_active', kind: 'boolean', required: true },
        { name: 'is_active_optional', kind: 'boolean', required: false },
        { name: 'parent_id', kind: 'fk', required: true, references: 'thing' },
        { name: 'parent_id_optional', kind: 'fk', required: false, references: 'thing' },
        { name: 'state', kind: 'enum', required: true, values: ['draft', 'live'] },
        { name: 'state_optional', kind: 'enum', required: false, values: ['x', 'y'] },
      ],
    },
  ],
  workflows: [
    {
      slug: 'do_thing',
      title: 'Do thing',
      trigger_entity: 'thing',
      trigger_event: 'create',
      steps: ['step_a', 'step_b'],
    },
    {
      slug: 'daily_thing',
      title: 'Daily check',
      trigger_entity: 'time',
      trigger_event: 'time',
      steps: ['cron_a'],
    },
  ],
  ui_sections: [
    { kind: 'table', entity: 'thing', columns: ['name', 'state'] },
    { kind: 'form', entity: 'thing' },
    { kind: 'kpi_tile', title: 'Total things', query: 'count(thing)' },
  ],
};

describe('compileSpec — every field kind branch', () => {
  it('emits VARCHAR for text-with-max_length and TEXT for unbounded text', () => {
    const r = compileSpec(allKindsSpec, 'tnt_x');
    expect(r.ok).toBe(true);
    expect(r.migrationSql).toMatch(/name\s+VARCHAR\(64\) NOT NULL/);
    expect(r.migrationSql).toMatch(/short_desc\s+TEXT/);
  });

  it('emits INTEGER for int fields (required and optional)', () => {
    const r = compileSpec(allKindsSpec, 'tnt_x');
    expect(r.migrationSql).toMatch(/qty\s+INTEGER NOT NULL/);
    expect(r.migrationSql).toMatch(/qty_default\s+INTEGER/);
  });

  it('emits NUMERIC with precision/scale defaults', () => {
    const r = compileSpec(allKindsSpec, 'tnt_x');
    expect(r.migrationSql).toMatch(/price\s+NUMERIC\(12, 2\) NOT NULL/);
    expect(r.migrationSql).toMatch(/price_default\s+NUMERIC\(18, 4\)/);
  });

  it('emits DATE for date kind', () => {
    const r = compileSpec(allKindsSpec, 'tnt_x');
    expect(r.migrationSql).toMatch(/live_from\s+DATE NOT NULL/);
    expect(r.migrationSql).toMatch(/live_from_optional\s+DATE,/);
  });

  it('emits TIMESTAMPTZ for datetime kind', () => {
    const r = compileSpec(allKindsSpec, 'tnt_x');
    expect(r.migrationSql).toMatch(/last_seen\s+TIMESTAMPTZ NOT NULL/);
    expect(r.migrationSql).toMatch(/last_seen_optional\s+TIMESTAMPTZ,/);
  });

  it('emits BOOLEAN for boolean kind', () => {
    const r = compileSpec(allKindsSpec, 'tnt_x');
    expect(r.migrationSql).toMatch(/is_active\s+BOOLEAN NOT NULL/);
    expect(r.migrationSql).toMatch(/is_active_optional\s+BOOLEAN,/);
  });

  it('emits soft TEXT pointer for fk kind', () => {
    const r = compileSpec(allKindsSpec, 'tnt_x');
    expect(r.migrationSql).toMatch(/parent_id\s+TEXT NOT NULL/);
    expect(r.migrationSql).toMatch(/parent_id_optional\s+TEXT,/);
  });

  it('emits CHECK constraint for enum kind (required and optional)', () => {
    const r = compileSpec(allKindsSpec, 'tnt_x');
    expect(r.migrationSql).toMatch(
      /state\s+TEXT NOT NULL CHECK \(state IN \('draft', 'live'\)\)/,
    );
    expect(r.migrationSql).toMatch(
      /state_optional\s+TEXT\s+CHECK \(state_optional IN \('x', 'y'\)\)/,
    );
  });

  it('emits workflow manifest with comment block', () => {
    const r = compileSpec(allKindsSpec, 'tnt_x');
    expect(r.migrationSql).toMatch(/workflow do_thing: Do thing/);
    expect(r.migrationSql).toMatch(/step_a → step_b/);
  });

  it('serialises every Zod validator tree variant', () => {
    const r = compileSpec(allKindsSpec, 'tnt_x');
    const thing = r.zodValidators.thing;
    expect(thing).toBeDefined();
    expect(thing?.fields.name?.kind).toBe('text');
    expect(thing?.fields.qty?.kind).toBe('int');
    expect(thing?.fields.price?.kind).toBe('numeric');
    expect(thing?.fields.cost?.kind).toBe('money');
    expect(thing?.fields.live_from?.kind).toBe('date');
    expect(thing?.fields.last_seen?.kind).toBe('datetime');
    expect(thing?.fields.is_active?.kind).toBe('boolean');
    expect(thing?.fields.parent_id?.kind).toBe('fk');
    expect(thing?.fields.parent_id?.references).toBe('thing');
    expect(thing?.fields.state?.kind).toBe('enum');
    expect(thing?.fields.state?.values).toEqual(['draft', 'live']);
  });

  it('builds UI layout with all 3 section kinds', () => {
    const r = compileSpec(allKindsSpec, 'tnt_x');
    const kinds = r.uiLayout.sections.map((s) => s.kind);
    expect(kinds).toEqual(['table', 'form', 'kpi_tile']);
  });

  it('emits an index for every field declared index:true', () => {
    const specWithIndex: ModuleSpec = {
      ...allKindsSpec,
      entities: [
        {
          slug: 'thing',
          display_name_en: 'Thing',
          fields: [
            { name: 'employee_number', kind: 'text', required: true, max_length: 32, index: true },
            { name: 'plain', kind: 'text', required: true },
          ],
        },
      ],
      workflows: [],
      ui_sections: [],
    };
    const r = compileSpec(specWithIndex, 'tnt_x');
    expect(r.migrationSql).toMatch(/module_tnt_x_thing_employee_number_idx/);
    expect(r.migrationSql).not.toMatch(/module_tnt_x_thing_plain_idx/);
  });
});

describe('compileSpec — empty workflow + ui list paths', () => {
  it('returns "no workflows declared" stub when none provided', () => {
    const spec: ModuleSpec = {
      entities: [
        {
          slug: 'minimal',
          display_name_en: 'Minimal',
          fields: [{ name: 'name', kind: 'text', required: true }],
        },
      ],
      workflows: [],
      ui_sections: [],
    };
    const r = compileSpec(spec, 'tnt_x');
    expect(r.migrationSql).toMatch(/no workflows declared/);
    expect(r.uiLayout.sections.length).toBe(0);
  });
});
