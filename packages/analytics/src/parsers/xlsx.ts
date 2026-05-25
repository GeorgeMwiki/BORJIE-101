/**
 * XLSX parser via injectable port.
 *
 * We do NOT bundle `xlsx`/`sheetjs` — it is a >2MB dep and would slow
 * pnpm install. Instead, callers pass in a thin adapter that returns
 * tab-separated rows. We provide an adapter contract so the API gateway
 * (which already has a file-parser pipeline) can wire its existing
 * xlsx loader as a one-liner.
 *
 * If you want a zero-config xlsx path, install `xlsx` in the consumer
 * and pass `xlsxAdapterFromSheetjs(XLSX)` (provided here as a tiny
 * helper that constructs the right adapter without us importing it).
 */

import type { ParsedRow } from '../types.js';
import { parseCsv } from './csv.js';

export interface XlsxAdapter {
  /** Convert a workbook (bytes) → CSV string for the first sheet (or `sheetName`). */
  toCsv(bytes: Uint8Array, sheetName?: string): string;
}

export interface XlsxParseOptions {
  readonly adapter: XlsxAdapter;
  readonly sheetName?: string;
  readonly hasHeader?: boolean;
  readonly inferTypes?: boolean;
}

export function parseXlsx(bytes: Uint8Array, opts: XlsxParseOptions): readonly ParsedRow[] {
  const csv = opts.adapter.toCsv(bytes, opts.sheetName);
  return parseCsv(csv, {
    hasHeader: opts.hasHeader ?? true,
    inferTypes: opts.inferTypes ?? true,
  });
}

/**
 * Construct an `XlsxAdapter` from an already-loaded sheetjs module.
 * The consumer imports `xlsx` and hands it here. This avoids us taking
 * sheetjs as a hard dep.
 *
 * Usage:
 *   import * as XLSX from 'xlsx';
 *   const adapter = xlsxAdapterFromSheetjs(XLSX);
 *   const rows = parseXlsx(bytes, { adapter });
 */
export function xlsxAdapterFromSheetjs(XLSX: {
  read(data: Uint8Array, opts: { type: 'array' }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_csv(sheet: unknown): string };
}): XlsxAdapter {
  return {
    toCsv(bytes, sheetName) {
      const wb = XLSX.read(bytes, { type: 'array' });
      const name = sheetName ?? wb.SheetNames[0];
      if (!name) throw new Error('[analytics/parsers/xlsx] workbook has no sheets');
      const sheet = wb.Sheets[name];
      if (!sheet) throw new Error(`[analytics/parsers/xlsx] sheet '${name}' not found`);
      return XLSX.utils.sheet_to_csv(sheet);
    },
  };
}
