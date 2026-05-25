/**
 * PDF → ParsedTable.
 *
 * The full PDF parser stack (pdf-parse) is heavy and noisy. For Phase J2 we
 * accept _extracted text_ as the input — production callers wire pdf-parse
 * upstream (it has a stable API), but the deterministic part of the
 * pipeline only needs the text.
 *
 * Heuristic: detect tabular layout by lines of consistent column counts,
 * delimited by two-or-more whitespace runs or pipe characters. Anything
 * else returns a single 'text' column so the LLM proposal layer can still
 * extract entities by free-text inference.
 *
 * Safety properties:
 *  - File-byte / row / column DoS ceilings (shared with CSV + Excel
 *    adapters) — see {@link DosGuardError}.
 *  - The free-text fallback runs every emitted row through the local PII
 *    redactor BEFORE it leaves the adapter. The redactor mirrors the
 *    sovereign-action-ledger redaction regexes (KRA PIN, NIDA, MSISDN per
 *    country, generic E.164 phone, email).
 */

import {
  DosGuardError,
  MAX_COLUMNS,
  MAX_FILE_BYTES,
  MAX_ROWS,
} from './dos-guards.js';
import { redactPiiFromString } from './pii-redactor.js';
import type { ParsedTable } from './types.js';

export interface PdfTextParseOptions {
  /**
   * If true, force single-column free-text mode (skip the table-detection
   * heuristic). Useful when the caller already knows the PDF is prose.
   */
  readonly forceFreeText?: boolean;
}

const COL_SPLIT_RX = /\s{2,}|\t+|\|/;

interface Candidate {
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
}

function tryDetectTable(lines: ReadonlyArray<string>): Candidate | null {
  const nonEmpty = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (nonEmpty.length < 3) return null;

  // Count fields per line under the delimiter heuristic.
  const fields = nonEmpty.map((l) =>
    l.split(COL_SPLIT_RX).map((c) => c.trim()).filter((c) => c.length > 0)
  );

  // Find the longest contiguous run of lines that share the same field
  // count >= 2. Real-world PDFs put tabular blocks _after_ prose, so we
  // can't only look at the head of the file.
  const MIN_RUN = 3;
  let bestStart = -1;
  let bestLen = 0;
  let bestCount = 0;
  let curStart = 0;
  let curCount = fields[0]?.length ?? 0;
  for (let i = 1; i <= fields.length; i += 1) {
    const cnt = i < fields.length ? fields[i]?.length ?? 0 : -1;
    if (cnt !== curCount) {
      const runLen = i - curStart;
      if (curCount >= 2 && runLen >= MIN_RUN && runLen > bestLen) {
        bestLen = runLen;
        bestStart = curStart;
        bestCount = curCount;
      }
      curStart = i;
      curCount = cnt;
    }
  }
  if (bestStart === -1 || bestCount < 2) return null;

  const headers = fields[bestStart] ?? [];
  const rows: string[][] = [];
  for (let i = bestStart + 1; i < bestStart + bestLen; i += 1) {
    const row = fields[i];
    if (row && row.length === bestCount) {
      rows.push(row);
    }
  }
  if (rows.length === 0) return null;

  return { headers, rows };
}

function utf8ByteLength(text: string): number {
  if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
    return Buffer.byteLength(text, 'utf8');
  }
  return new TextEncoder().encode(text).byteLength;
}

export function parsePdfText(text: string, options: PdfTextParseOptions = {}): ParsedTable {
  const size = utf8ByteLength(text);
  if (size > MAX_FILE_BYTES) {
    throw new DosGuardError(
      `PDF text exceeds DoS-guard ceiling: ${size} bytes > ${MAX_FILE_BYTES} bytes`,
      'file_bytes',
      size,
      MAX_FILE_BYTES
    );
  }

  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);

  if (!options.forceFreeText) {
    const detected = tryDetectTable(lines);
    if (detected) {
      if (detected.rows.length > MAX_ROWS) {
        throw new DosGuardError(
          `PDF row count exceeds DoS-guard ceiling: ${detected.rows.length} rows > ${MAX_ROWS}`,
          'rows',
          detected.rows.length,
          MAX_ROWS
        );
      }
      if (detected.headers.length > MAX_COLUMNS) {
        throw new DosGuardError(
          `PDF column count exceeds DoS-guard ceiling: ${detected.headers.length} columns > ${MAX_COLUMNS}`,
          'columns',
          detected.headers.length,
          MAX_COLUMNS
        );
      }
      return Object.freeze({
        headers: Object.freeze(detected.headers.map((h, idx) =>
          h && h.trim() ? h.trim() : `column_${idx + 1}`
        )),
        rows: Object.freeze(detected.rows),
        source_format: 'pdf',
        ingest_warnings: Object.freeze([...warnings]),
      });
    }
  }

  // Free-text fallback: every non-blank line becomes one row with a single
  // 'text' column. The proposal layer is then responsible for extracting
  // structured entities from prose. CRITICAL: every line is redacted of
  // PII before it leaves the adapter, since the row text will feed the
  // LLM proposal step (which downstream may persist or log the prompt).
  const rows: string[][] = [];
  let redactedLines = 0;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const scrubbed = redactPiiFromString(trimmed);
    if (scrubbed !== trimmed) redactedLines += 1;
    rows.push([scrubbed]);
  }

  if (rows.length > MAX_ROWS) {
    throw new DosGuardError(
      `PDF row count exceeds DoS-guard ceiling: ${rows.length} rows > ${MAX_ROWS}`,
      'rows',
      rows.length,
      MAX_ROWS
    );
  }
  if (redactedLines > 0) {
    warnings.push(
      `pii-redactor: ${redactedLines} free-text line(s) had PII tokens replaced before emission`
    );
  }

  return Object.freeze({
    headers: Object.freeze(['text']),
    rows: Object.freeze(rows),
    source_format: 'pdf',
    ingest_warnings: Object.freeze([...warnings]),
  });
}
