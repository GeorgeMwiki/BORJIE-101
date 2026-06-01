/**
 * OCR → entity bridge.
 *
 * Stage-0 adapter that lets an uploaded DOCUMENT (a scanned worker
 * roster, a mining-licence certificate, a buyer KYB sheet) drive the
 * onboarding bootstrap — not just a hand-curated CSV.
 *
 * `ocr_extractions.extracted_fields` is a JSONB blob produced by the
 * document-intelligence OCR pipeline (see
 * `packages/database/src/schemas/documents.schema.ts`). Its shape is
 * provider-dependent, so this bridge normalises the two real shapes
 * into the package's canonical `TabularSample`:
 *
 *   1. ROW-LIST shape — a multi-record document (e.g. a roster page):
 *        { rows: [ { nida: "…", name: "…", role: "…" }, … ] }
 *      or the bare array alias `{ records: [...] }` / `{ items: [...] }`.
 *
 *   2. SINGLE-RECORD shape — a one-entity document (e.g. a single
 *      licence certificate):
 *        { licence_no: "…", expiry: "…", authority: "…" }
 *      → collapses to a one-row sample.
 *
 * The bridge is pure: no I/O, no DB. The caller (api-gateway) loads the
 * `ocr_extractions` row tenant-scoped and hands the `extracted_fields`
 * plus the source document metadata in. The resulting `TabularSample`
 * flows straight into `recognizeEntityType` / a recipe's `discover`.
 *
 * The header set is the UNION of every key seen across all rows so the
 * downstream column matcher sees a stable, complete header vector even
 * when individual rows omit a sparse field.
 */

import type { TabularSample } from '../types.js';

/** A single extracted record — flat key→scalar map. */
type ExtractedRecord = Readonly<Record<string, unknown>>;

export interface OcrToSampleArgs {
  /** `ocr_extractions.id` — becomes the sample's `source_file.id`. */
  readonly extraction_id: string;
  /** Human label for the source document (file name or doc title). */
  readonly document_name: string;
  /** Optional sheet / page label. */
  readonly page_label?: string;
  /** The raw `ocr_extractions.extracted_fields` JSONB value. */
  readonly extracted_fields: unknown;
}

/** Keys that, when present and array-valued, hold the record list. */
const ROW_LIST_KEYS: ReadonlyArray<string> = Object.freeze([
  'rows',
  'records',
  'items',
  'entries',
  'lines',
]);

function isPlainRecord(value: unknown): value is ExtractedRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Extract the record list from a JSONB `extracted_fields` blob.
 * Falls back to treating the blob itself as a single record.
 */
function toRecords(extracted_fields: unknown): ReadonlyArray<ExtractedRecord> {
  if (Array.isArray(extracted_fields)) {
    return extracted_fields.filter(isPlainRecord);
  }
  if (isPlainRecord(extracted_fields)) {
    for (const key of ROW_LIST_KEYS) {
      const candidate = extracted_fields[key];
      if (Array.isArray(candidate)) {
        const records = candidate.filter(isPlainRecord);
        if (records.length > 0) return records;
      }
    }
    // Single-record document — collapse to a one-row sample.
    return Object.freeze([extracted_fields]);
  }
  return Object.freeze([]);
}

/** Stable union of keys across every record, preserving first-seen order. */
function unionHeaders(
  records: ReadonlyArray<ExtractedRecord>,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }
  return Object.freeze(ordered);
}

/** Render one cell value as a string (TabularSample rows are string[]). */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  // Nested objects/arrays — serialise so no information is silently lost.
  return JSON.stringify(value);
}

/**
 * Map an `ocr_extractions.extracted_fields` blob into a canonical
 * `TabularSample` so an uploaded document can drive the onboarding
 * recipe pipeline exactly like a CSV upload.
 *
 * Returns a sample with zero rows (and zero headers) when the blob
 * carries no usable records — the caller compares against the entity
 * confidence floor and surfaces a clarifying prompt rather than
 * persisting an empty feed.
 */
export function ocrExtractionToTabularSample(
  args: OcrToSampleArgs,
): TabularSample {
  const records = toRecords(args.extracted_fields);
  const headers = unionHeaders(records);
  const rows: ReadonlyArray<ReadonlyArray<string>> = Object.freeze(
    records.map((record) =>
      Object.freeze(headers.map((header) => cellToString(record[header]))),
    ),
  );

  return Object.freeze({
    source_file: Object.freeze({
      id: args.extraction_id,
      name: args.document_name,
      ...(args.page_label !== undefined ? { sheet: args.page_label } : {}),
    }),
    headers,
    rows,
    total_row_count: rows.length,
  });
}

export const __TEST_ONLY = Object.freeze({
  toRecords,
  unionHeaders,
  cellToString,
});
