/**
 * CSV → ParsedTable, using papaparse for robust quoting / escape / delim
 * detection. Returns a deterministic ParsedTable; never throws on malformed
 * cells (papaparse already coerces silently). The caller's responsibility is
 * to feed UTF-8 text, not raw bytes.
 *
 * Two safety properties layered on top of papaparse:
 *
 *  - File-byte / row / column DoS ceilings. Refuse early on oversize input
 *    via {@link DosGuardError} so the chat UI gets a structured refusal.
 *  - papaparse `result.errors` are surfaced on the returned ParsedTable as
 *    `ingest_warnings`. The previous version silently dropped them, which
 *    hid problems like "Quoted field unterminated".
 */

import Papa from 'papaparse';

import {
  DosGuardError,
  MAX_COLUMNS,
  MAX_FILE_BYTES,
  MAX_ROWS,
} from './dos-guards.js';
import type { ParsedTable } from './types.js';

export interface CsvParseOptions {
  /** If true, treat the first row as headers (default: true). */
  readonly hasHeader?: boolean;
  /** If supplied, override papaparse's auto-detected delimiter. */
  readonly delimiter?: string;
}

function utf8ByteLength(text: string): number {
  // Buffer.byteLength is the cheapest accurate UTF-8 byte counter on Node.
  // Falls back to TextEncoder for non-Node runtimes.
  if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
    return Buffer.byteLength(text, 'utf8');
  }
  return new TextEncoder().encode(text).byteLength;
}

export function parseCsv(text: string, options: CsvParseOptions = {}): ParsedTable {
  const size = utf8ByteLength(text);
  if (size > MAX_FILE_BYTES) {
    throw new DosGuardError(
      `CSV exceeds DoS-guard ceiling: ${size} bytes > ${MAX_FILE_BYTES} bytes`,
      'file_bytes',
      size,
      MAX_FILE_BYTES
    );
  }

  const hasHeader = options.hasHeader ?? true;

  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    ...(options.delimiter ? { delimiter: options.delimiter } : {}),
  });

  const warnings: string[] = [];
  for (const err of result.errors ?? []) {
    // Papaparse errors are advisory by default. We surface them so the
    // chat UI can render a "fyi" alongside the proposed mapping.
    const row = typeof err.row === 'number' ? ` (row ${err.row})` : '';
    warnings.push(`${err.type ?? 'csv'}/${err.code ?? 'unknown'}: ${err.message}${row}`);
  }

  const data: ReadonlyArray<ReadonlyArray<string>> = (result.data ?? []).map((row) =>
    Array.isArray(row) ? row.map((v) => (v ?? '').toString()) : []
  );

  if (data.length === 0) {
    return Object.freeze({
      headers: Object.freeze([]),
      rows: Object.freeze([]),
      source_format: 'csv',
      ingest_warnings: Object.freeze([...warnings]),
    });
  }

  // Row + column DoS guards. We count BEFORE skimming the header off so the
  // ceiling is consistent across hasHeader / no-header callers.
  if (data.length > MAX_ROWS) {
    throw new DosGuardError(
      `CSV row count exceeds DoS-guard ceiling: ${data.length} rows > ${MAX_ROWS}`,
      'rows',
      data.length,
      MAX_ROWS
    );
  }
  let widestRow = 0;
  for (const row of data) {
    if (row.length > widestRow) widestRow = row.length;
  }
  if (widestRow > MAX_COLUMNS) {
    throw new DosGuardError(
      `CSV column count exceeds DoS-guard ceiling: ${widestRow} columns > ${MAX_COLUMNS}`,
      'columns',
      widestRow,
      MAX_COLUMNS
    );
  }

  if (!hasHeader) {
    const firstRow = data[0] ?? [];
    const headers = firstRow.map((_, idx) => `column_${idx + 1}`);
    return Object.freeze({
      headers: Object.freeze(headers),
      rows: Object.freeze(data),
      source_format: 'csv',
      ingest_warnings: Object.freeze([...warnings]),
    });
  }

  const headers = (data[0] ?? []).map((h, idx) =>
    h && h.trim() ? h.trim() : `column_${idx + 1}`
  );
  const rows = data.slice(1);

  return Object.freeze({
    headers: Object.freeze(headers),
    rows: Object.freeze(rows),
    source_format: 'csv',
    ingest_warnings: Object.freeze([...warnings]),
  });
}
