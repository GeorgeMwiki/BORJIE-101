/**
 * Schema-sniff Excel coverage. We generate xlsx buffers in-test using
 * SheetJS so the suite is hermetic (no binary fixtures to keep in sync).
 * 5 variants cover the same shape-classes as the CSV tests: happy path,
 * empty workbook, header-only, mixed types per column, sheet name override.
 */

import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseExcel } from '../schema-sniff/excel-adapter.js';
import { inferSchema } from '../schema-sniff/infer.js';

function buildXlsx(rows: ReadonlyArray<ReadonlyArray<string>>, sheetName = 'Sheet1'): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows as string[][]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return out as Buffer;
}

describe('schema-sniff: Excel', () => {
  it('parses an HR roster workbook with header + 3 rows', () => {
    const buf = buildXlsx([
      ['full_name', 'email', 'phone', 'role', 'start_date'],
      ['Asha Mwangi', 'asha@bn.co.tz', '+255712345678', 'Manager', '2024-03-15'],
      ['Brian Otieno', 'brian@bn.co.tz', '+255713456789', 'Lead', '2023-11-01'],
      ['Catherine W.', 'cathy@bn.co.tz', '+255714567890', 'Accountant', '2025-01-10'],
    ]);
    const table = parseExcel(buf);
    const schema = inferSchema(table);
    expect(table.source_format).toEqual('excel');
    expect(schema.rowCount).toEqual(3);
    expect(schema.columns.map((c) => c.name)).toEqual([
      'full_name',
      'email',
      'phone',
      'role',
      'start_date',
    ]);
    const email = schema.columns.find((c) => c.name === 'email');
    expect(email?.type).toEqual('email');
  });

  it('empty workbook returns empty schema', () => {
    const buf = buildXlsx([]);
    const table = parseExcel(buf);
    const schema = inferSchema(table);
    expect(schema.rowCount).toEqual(0);
    expect(schema.columns).toHaveLength(0);
  });

  it('header-only workbook returns zero rows + unknown-typed columns', () => {
    const buf = buildXlsx([['id', 'name', 'email']]);
    const table = parseExcel(buf);
    const schema = inferSchema(table);
    expect(schema.rowCount).toEqual(0);
    expect(schema.columns).toHaveLength(3);
    for (const col of schema.columns) {
      expect(col.type).toEqual('unknown');
    }
  });

  it('mixed-type column degrades gracefully to string', () => {
    const buf = buildXlsx([
      ['code', 'value'],
      ['A', '100'],
      ['B', 'twenty'],
      ['C', '300'],
      ['D', '400'],
      ['E', 'five-hundred'],
    ]);
    const table = parseExcel(buf);
    const schema = inferSchema(table);
    const valueCol = schema.columns.find((c) => c.name === 'value');
    expect(valueCol).toBeDefined();
    // 3 of 5 are integers (60%) — below the 70% type-confidence threshold
    // so we fall back to string.
    expect(valueCol!.type).toEqual('string');
  });

  it('explicit sheet name override picks the correct sheet', () => {
    const ws1 = XLSX.utils.aoa_to_sheet([['a', 'b'], ['1', '2']]);
    const ws2 = XLSX.utils.aoa_to_sheet([
      ['name', 'email'],
      ['Asha', 'asha@bn.co.tz'],
      ['Brian', 'brian@bn.co.tz'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Junk');
    XLSX.utils.book_append_sheet(wb, ws2, 'Roster');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const table = parseExcel(buf, { sheet: 'Roster' });
    expect(table.headers).toEqual(['name', 'email']);
    expect(table.rows).toHaveLength(2);
  });
});
