/**
 * Stage 2.a — Tabular sampler.
 *
 * Slices the first N data rows from a parsed table for column-type
 * inference. Defensive against short tables and missing values. Pure
 * function — no I/O.
 */

import type { TabularSample } from '../types.js';
import { DEFAULT_DISCOVERY_SAMPLE_SIZE } from '../types.js';

export interface SampledTable {
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  readonly sample_rows_count: number;
  readonly total_row_count: number;
  readonly source_file: TabularSample['source_file'];
}

export function sampleTable(
  sample: TabularSample,
  size: number = DEFAULT_DISCOVERY_SAMPLE_SIZE,
): SampledTable {
  const capped = Math.max(0, Math.min(size, sample.rows.length));
  const rows = sample.rows.slice(0, capped);
  return Object.freeze({
    headers: Object.freeze([...sample.headers]),
    rows: Object.freeze(rows.map((r) => Object.freeze([...r]))),
    sample_rows_count: rows.length,
    total_row_count: sample.total_row_count,
    source_file: sample.source_file,
  });
}

export function columnValues(
  table: SampledTable,
  column_index: number,
): ReadonlyArray<string> {
  return table.rows.map((row) => row[column_index] ?? '');
}
