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

// Decompression-bomb guard for OOXML (XLSX/DOCX = ZIP container). The byte
// ceiling only bounds the COMPRESSED bytes; a tiny file can expand to
// gigabytes inside XLSX.read. We sum the uncompressed sizes from the ZIP
// central directory and reject before parsing. Legacy .xls (OLE2, not a
// ZIP) passes through — SheetJS + the byte cap bound those.
const ZIP_LOCAL_SIG = 0x04034b50; // "PK\x03\x04"
const ZIP_EOCD_SIG = 0x06054b50; // "PK\x05\x06"
const ZIP_CDIR_SIG = 0x02014b50; // "PK\x01\x02"
const MAX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024; // 250 MB expanded

function toU8(bytes: Buffer | Uint8Array | ArrayBuffer): Uint8Array {
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function readU32LE(b: Uint8Array, o: number): number {
  return (
    ((b[o] ?? 0) |
      ((b[o + 1] ?? 0) << 8) |
      ((b[o + 2] ?? 0) << 16) |
      ((b[o + 3] ?? 0) << 24)) >>>
    0
  );
}

function readU16LE(b: Uint8Array, o: number): number {
  return ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8)) >>> 0;
}

function assertOoxmlNotZipBomb(
  input: Buffer | Uint8Array | ArrayBuffer,
  cap: number = MAX_UNCOMPRESSED_BYTES,
): void {
  const b = toU8(input);
  if (b.length < 22) return;
  if (readU32LE(b, 0) !== ZIP_LOCAL_SIG) return; // not a ZIP → skip
  // Find the End-Of-Central-Directory record (scan back over the comment).
  let eocd = -1;
  const minStart = Math.max(0, b.length - 22 - 0xffff);
  for (let i = b.length - 22; i >= minStart; i -= 1) {
    if (readU32LE(b, i) === ZIP_EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return; // unparseable → let SheetJS + byte cap handle it
  const entries = readU16LE(b, eocd + 10);
  let cd = readU32LE(b, eocd + 16);
  let total = 0;
  for (let n = 0; n < entries; n += 1) {
    if (cd + 46 > b.length || readU32LE(b, cd) !== ZIP_CDIR_SIG) break;
    const uncompressed = readU32LE(b, cd + 24);
    // ZIP64 sentinel — real size hides in the extra field; refuse outright.
    if (uncompressed === 0xffffffff) {
      throw new DosGuardError(
        'ZIP64 OOXML entry — refusing potential decompression bomb',
        'file_bytes',
        cap + 1,
        cap,
      );
    }
    total += uncompressed;
    if (total > cap) {
      throw new DosGuardError(
        `OOXML decompressed size exceeds ceiling: ${total} bytes > ${cap} bytes`,
        'file_bytes',
        total,
        cap,
      );
    }
    const nameLen = readU16LE(b, cd + 28);
    const extraLen = readU16LE(b, cd + 30);
    const commentLen = readU16LE(b, cd + 32);
    cd += 46 + nameLen + extraLen + commentLen;
  }
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

  // Reject decompression bombs before XLSX.read materialises them in memory.
  assertOoxmlNotZipBomb(bytes);

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
