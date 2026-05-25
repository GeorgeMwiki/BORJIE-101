/**
 * Excel → ParsedTable, using SheetJS (xlsx). Always reads the first sheet
 * unless a sheet name is supplied. Cell values are coerced to strings so
 * the type-inference pass sees raw text — matching the CSV path.
 *
 * Security:
 *  - SheetJS is invoked with hardened options (no formulas, HTML, VBA, or
 *    stubs). See CVE-2023-30533 (prototype pollution) and CVE-2024-22363
 *    (ReDoS) for context. The dangerous defaults are explicitly disabled.
 *  - Byte/row/column ceilings are enforced via the shared DoS-guard
 *    constants. A workbook that breaches the caps throws DosGuardError
 *    before any parsing is attempted (or, for row/column caps, before
 *    materialising the row matrix).
 */

import * as XLSX from 'xlsx';

import {
  DosGuardError,
  MAX_COLUMNS,
  MAX_FILE_BYTES,
  MAX_ROWS,
} from './dos-guards.js';
import type { ParsedTable } from './types.js';

export interface ExcelParseOptions {
  /** Sheet name. Defaults to the workbook's first sheet. */
  readonly sheet?: string;
  /** If true (default), the first row is the header row. */
  readonly hasHeader?: boolean;
}

function byteLength(bytes: Buffer | Uint8Array | ArrayBuffer): number {
  if (bytes instanceof ArrayBuffer) return bytes.byteLength;
  return bytes.byteLength;
}

function emptyTable(warnings: ReadonlyArray<string>): ParsedTable {
  return Object.freeze({
    headers: Object.freeze([]),
    rows: Object.freeze([]),
    source_format: 'excel',
    ingest_warnings: Object.freeze([...warnings]),
  });
}

export function parseExcel(
  bytes: Buffer | Uint8Array | ArrayBuffer,
  options: ExcelParseOptions = {}
): ParsedTable {
  const size = byteLength(bytes);
  if (size > MAX_FILE_BYTES) {
    throw new DosGuardError(
      `Excel file exceeds DoS-guard ceiling: ${size} bytes > ${MAX_FILE_BYTES} bytes`,
      'file_bytes',
      size,
      MAX_FILE_BYTES
    );
  }

  const warnings: string[] = [];

  // Hardened SheetJS options. Disables formula evaluation, HTML cell
  // content, embedded VBA, and stub cells — all of which have been the
  // root cause of past SheetJS CVEs (CVE-2023-30533, CVE-2024-22363).
  // `dense: true` reduces the in-memory footprint of the sheet model.
  const workbook = XLSX.read(bytes, {
    type: 'array',
    cellDates: false,
    sheetStubs: false,
    cellFormula: false,
    cellHTML: false,
    bookVBA: false,
    dense: true,
  });
  const sheetName = options.sheet ?? workbook.SheetNames[0] ?? null;
  if (!sheetName) {
    return emptyTable(warnings);
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return emptyTable(warnings);
  }

  // sheet_to_json with header:1 gives us a matrix of cells. raw:false coerces
  // to strings (matching CSV behaviour for the type-sniffer).
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
  });

  const cleaned: string[][] = matrix
    .filter((row) => Array.isArray(row))
    .map((row) =>
      row.map((v) => (v === undefined || v === null ? '' : String(v)))
    );

  if (cleaned.length === 0) {
    return emptyTable(warnings);
  }

  // Row/column DoS guards — enforce BEFORE we walk the matrix.
  if (cleaned.length > MAX_ROWS) {
    throw new DosGuardError(
      `Excel row count exceeds DoS-guard ceiling: ${cleaned.length} rows > ${MAX_ROWS}`,
      'rows',
      cleaned.length,
      MAX_ROWS
    );
  }
  let widestRow = 0;
  for (const row of cleaned) {
    if (row.length > widestRow) widestRow = row.length;
  }
  if (widestRow > MAX_COLUMNS) {
    throw new DosGuardError(
      `Excel column count exceeds DoS-guard ceiling: ${widestRow} columns > ${MAX_COLUMNS}`,
      'columns',
      widestRow,
      MAX_COLUMNS
    );
  }

  const hasHeader = options.hasHeader ?? true;
  if (!hasHeader) {
    const firstRow = cleaned[0] ?? [];
    const headers = firstRow.map((_, idx) => `column_${idx + 1}`);
    return Object.freeze({
      headers: Object.freeze(headers),
      rows: Object.freeze(cleaned),
      source_format: 'excel',
      ingest_warnings: Object.freeze([...warnings]),
    });
  }

  const headers = (cleaned[0] ?? []).map((h, idx) =>
    h && h.trim() ? h.trim() : `column_${idx + 1}`
  );

  // Normalise row width to the header width so type-sniffer sees consistent
  // tuples. Longer rows are truncated; shorter rows are padded with ''.
  const width = headers.length;
  const rows = cleaned.slice(1).map((row) => {
    if (row.length === width) return row;
    if (row.length > width) return row.slice(0, width);
    return [...row, ...Array.from({ length: width - row.length }, () => '')];
  });

  return Object.freeze({
    headers: Object.freeze(headers),
    rows: Object.freeze(rows),
    source_format: 'excel',
    ingest_warnings: Object.freeze([...warnings]),
  });
}
