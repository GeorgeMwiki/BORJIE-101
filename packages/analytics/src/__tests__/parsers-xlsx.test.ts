import { describe, expect, it } from 'vitest';
import { parseXlsx, type XlsxAdapter } from '../parsers/index.js';

const fakeAdapter: XlsxAdapter = {
  toCsv(bytes, sheetName) {
    // The adapter sees the raw bytes — return a deterministic CSV so we
    // can verify that `parseXlsx` re-uses the CSV pipeline correctly.
    return `sheet,${sheetName ?? 'first'},bytes\n1,${bytes.length},2`;
  },
};

describe('parsers / parseXlsx', () => {
  it('delegates byte → csv conversion to the injected adapter', () => {
    const rows = parseXlsx(new Uint8Array([1, 2, 3]), { adapter: fakeAdapter, inferTypes: true });
    expect(rows[0]).toEqual({ sheet: 1, first: 3, bytes: 2 });
  });

  it('passes through the sheet name', () => {
    const rows = parseXlsx(new Uint8Array([0]), { adapter: fakeAdapter, sheetName: 'Q3' });
    expect(rows[0]?.['Q3']).toBeDefined();
  });
});
