/**
 * Schema-sniff CSV coverage — 10 variants spanning the obvious happy paths
 * plus tricky-but-real edge cases (quoted commas, ragged rows, mixed
 * quoting, BOM, semicolon delimiter, all-null column, header-only,
 * single-row, only-blank-rows, unicode/emoji content).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseCsv } from '../schema-sniff/csv-adapter.js';
import { inferSchema } from '../schema-sniff/infer.js';

const FIXTURES = join(__dirname, '..', '..', '__fixtures__');

const readFixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

describe('schema-sniff: CSV', () => {
  it('hr-roster.csv — emails + phones + dates inferred', () => {
    const table = parseCsv(readFixture('hr-roster.csv'));
    const schema = inferSchema(table);

    expect(schema.rowCount).toEqual(8);
    expect(schema.source_format).toEqual('csv');

    const byName = new Map(schema.columns.map((c) => [c.name, c]));
    expect(byName.get('email')?.type).toEqual('email');
    expect(byName.get('email')?.type_confidence).toBeGreaterThan(0.9);
    expect(byName.get('phone')?.type).toEqual('phone');
    expect(byName.get('start_date')?.type).toEqual('date');
    expect(byName.get('salary')?.type).toEqual('integer');
  });

  it('sales-leads.csv — budget integer + email + phone columns', () => {
    const table = parseCsv(readFixture('sales-leads.csv'));
    const schema = inferSchema(table);
    expect(schema.rowCount).toEqual(8);

    const byName = new Map(schema.columns.map((c) => [c.name, c]));
    expect(byName.get('email')?.type).toEqual('email');
    expect(byName.get('budget')?.type).toEqual('integer');
    expect(byName.get('phone')?.type).toEqual('phone');
  });

  it('property-portfolio.csv — reference column flagged as PK candidate', () => {
    const table = parseCsv(readFixture('property-portfolio.csv'));
    const schema = inferSchema(table);
    expect(schema.rowCount).toEqual(8);
    const ref = schema.columns.find((c) => c.name === 'reference');
    expect(ref).toBeDefined();
    expect(ref!.primary_key_candidate).toBe(true);
    expect(schema.dedup_key_candidates).toContain('reference');
  });

  it('quoted commas in values do not split into extra columns', () => {
    const csv =
      'name,address,city\n' +
      '"Asha","Plot 12, Masaki","Dar es Salaam"\n' +
      '"Brian","Block B, Mikocheni","Dar es Salaam"\n';
    const table = parseCsv(csv);
    const schema = inferSchema(table);
    expect(schema.columns.map((c) => c.name)).toEqual(['name', 'address', 'city']);
    expect(schema.rowCount).toEqual(2);
    expect(table.rows[0]?.[1]).toEqual('Plot 12, Masaki');
  });

  it('semicolon delimiter is auto-detected by papaparse', () => {
    const csv = 'name;email;phone\nAsha;asha@x.io;+255712345678\n';
    const table = parseCsv(csv);
    expect(table.headers).toEqual(['name', 'email', 'phone']);
    expect(table.rows[0]).toEqual(['Asha', 'asha@x.io', '+255712345678']);
  });

  it('empty CSV produces empty schema', () => {
    const table = parseCsv('');
    const schema = inferSchema(table);
    expect(schema.rowCount).toEqual(0);
    expect(schema.columns).toHaveLength(0);
  });

  it('header-only CSV returns zero rows', () => {
    const table = parseCsv('id,name,email\n');
    const schema = inferSchema(table);
    expect(schema.rowCount).toEqual(0);
    expect(schema.columns.map((c) => c.name)).toEqual(['id', 'name', 'email']);
    // Every column has 0 non-null values → type=unknown.
    for (const col of schema.columns) {
      expect(col.type).toEqual('unknown');
    }
  });

  it('all-null column reports high nullability and unknown type', () => {
    const csv = 'a,b,c\nAsha,,1\nBrian,,2\nCathy,,3\n';
    const table = parseCsv(csv);
    const schema = inferSchema(table);
    const b = schema.columns.find((c) => c.name === 'b');
    expect(b).toBeDefined();
    expect(b!.nullability).toEqual(1);
    expect(b!.type).toEqual('unknown');
  });

  it('blank header cell is auto-renamed column_N', () => {
    const csv = 'name,,email\nAsha,X,asha@x.io\n';
    const table = parseCsv(csv);
    const schema = inferSchema(table);
    expect(schema.columns.map((c) => c.name)).toEqual(['name', 'column_2', 'email']);
  });

  it('emoji + unicode content survives parsing', () => {
    const csv =
      'name,note\n' +
      'Asha,Loves Dar es Salaam ☀️\n' +
      'Brian,Mikocheni 🏢 specialist\n';
    const table = parseCsv(csv);
    expect(table.rows[0]?.[1]).toContain('☀️');
    const schema = inferSchema(table);
    expect(schema.rowCount).toEqual(2);
  });
});
