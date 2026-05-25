/**
 * Built-in CSV parser — RFC 4180 compliant, zero dependencies.
 *
 * Why no `papaparse` dep: it is 80kB and our consumer surface is
 * read-only, headers-first CSV from controlled uploads. The parser
 * we ship is ~120 lines, tested, and avoids the long pnpm install.
 *
 * Supports:
 *   - Quoted fields with embedded commas and newlines
 *   - "" escape inside quoted fields
 *   - CRLF or LF line endings
 *   - Optional header row (default: true)
 *   - Optional type inference (default: false) — converts numeric +
 *     ISO-date-looking strings.
 */

import type { ParsedRow } from '../types.js';

export interface CsvParseOptions {
  readonly hasHeader?: boolean;
  readonly delimiter?: string;
  /** When true, numeric and ISO-date strings are coerced. */
  readonly inferTypes?: boolean;
}

export function parseCsv(content: string, opts: CsvParseOptions = {}): readonly ParsedRow[] {
  const delim = opts.delimiter ?? ',';
  const hasHeader = opts.hasHeader ?? true;
  const infer = opts.inferTypes ?? false;

  if (delim.length !== 1) {
    throw new Error(`[analytics/parsers] CSV delimiter must be exactly one char, got '${delim}'`);
  }

  const rows = tokenize(content, delim);
  if (rows.length === 0) return [];

  let headers: string[];
  let dataRows: readonly string[][];
  if (hasHeader) {
    const headerRow = rows[0];
    if (!headerRow) return [];
    headers = headerRow.map((h) => h.trim());
    dataRows = rows.slice(1);
  } else {
    const firstRow = rows[0];
    if (!firstRow) return [];
    headers = firstRow.map((_, i) => `col_${i + 1}`);
    dataRows = rows;
  }

  const out: ParsedRow[] = [];
  for (const fields of dataRows) {
    // Skip purely empty rows (single empty field).
    if (fields.length === 1 && fields[0] === '') continue;
    const row: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i];
      if (typeof key !== 'string') continue;
      const raw = fields[i] ?? '';
      row[key] = infer ? coerce(raw) : raw;
    }
    out.push(Object.freeze(row));
  }
  return out;
}

/**
 * Minimal RFC 4180 tokenizer. Returns rows of string fields.
 */
function tokenize(content: string, delim: string): readonly string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = content.length;

  while (i < len) {
    const ch = content[i] ?? '';
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      current.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      // Swallow CR; the LF that follows ends the row.
      i++;
      continue;
    }
    if (ch === '\n') {
      current.push(field);
      rows.push(current);
      current = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Final field — only push if we have any content or pending row.
  if (field.length > 0 || current.length > 0) {
    current.push(field);
    rows.push(current);
  }
  return rows;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function coerce(value: string): unknown {
  if (value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  // Integer.
  if (/^-?\d+$/.test(value)) {
    const n = Number(value);
    if (Number.isSafeInteger(n)) return n;
  }
  // Float — guard against accidental NaN.
  if (/^-?\d+\.\d+$/.test(value) || /^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(value)) {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  if (ISO_DATE_RE.test(value)) {
    return value; // keep as string for portability; SchemaProfile flags it as timestamp
  }
  return value;
}
