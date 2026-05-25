import { describe, expect, it } from 'vitest';
import { parseCsv } from '../parsers/index.js';

describe('parsers / parseCsv', () => {
  it('parses a simple header row', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n4,5,6');
    expect(rows).toEqual([
      { a: '1', b: '2', c: '3' },
      { a: '4', b: '5', c: '6' },
    ]);
  });

  it('infers numbers + booleans when inferTypes is on', () => {
    const rows = parseCsv('a,b,c\n1,true,3.5\n2,false,7', { inferTypes: true });
    expect(rows[0]).toEqual({ a: 1, b: true, c: 3.5 });
    expect(rows[1]).toEqual({ a: 2, b: false, c: 7 });
  });

  it('handles quoted fields with commas', () => {
    const rows = parseCsv('a,b\n"hello, world",ok');
    expect(rows[0]).toEqual({ a: 'hello, world', b: 'ok' });
  });

  it('handles "" escape inside quoted field', () => {
    const rows = parseCsv('a\n"He said ""hi"""');
    expect(rows[0]?.['a']).toBe('He said "hi"');
  });

  it('handles embedded newlines in quoted fields', () => {
    const rows = parseCsv('a,b\n"line1\nline2",ok');
    expect(rows[0]?.['a']).toBe('line1\nline2');
  });

  it('respects CRLF line endings', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n3,4');
    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('synthesises col_N when hasHeader is false', () => {
    const rows = parseCsv('1,2,3\n4,5,6', { hasHeader: false });
    expect(rows[0]).toEqual({ col_1: '1', col_2: '2', col_3: '3' });
  });

  it('rejects multi-char delimiter', () => {
    expect(() => parseCsv('a,b', { delimiter: ',,' })).toThrow(/delimiter/);
  });

  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('skips trailing empty rows', () => {
    const rows = parseCsv('a,b\n1,2\n');
    expect(rows).toHaveLength(1);
  });

  it('coerces ISO timestamps as strings (downstream infers type)', () => {
    const rows = parseCsv('a\n2026-01-15T10:00:00Z', { inferTypes: true });
    expect(rows[0]?.['a']).toBe('2026-01-15T10:00:00Z');
  });

  it('round-trips a 100-row table without loss', () => {
    const headers = 'id,name,amount';
    const dataLines: string[] = [];
    for (let i = 0; i < 100; i++) {
      dataLines.push(`${i},name_${i},${i * 10}`);
    }
    const csv = [headers, ...dataLines].join('\n');
    const rows = parseCsv(csv, { inferTypes: true });
    expect(rows).toHaveLength(100);
    expect(rows[50]).toEqual({ id: 50, name: 'name_50', amount: 500 });
  });
});
