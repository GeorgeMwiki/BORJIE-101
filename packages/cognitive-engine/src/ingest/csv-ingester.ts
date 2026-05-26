/**
 * CSV ingester — Discipline 6, CSV path.
 *
 * Thin alias around the tabular ingest path. Kept as a separate module
 * so the file layout matches the spec's §3 ingest box and so tests can
 * exercise it independently of Excel.
 *
 * @module @borjie/cognitive-engine/ingest/csv-ingester
 */

import type { AdaptiveIngestResult } from '../types.js';
import {
  ingestCsvViaExcelIngester,
  type IngestExcelDeps,
  type IngestExcelInput,
} from './excel-ingester.js';

export type IngestCsvInput = IngestExcelInput;
export type IngestCsvDeps = IngestExcelDeps;

export async function ingestCsv(
  input: IngestCsvInput,
  deps: IngestCsvDeps,
): Promise<AdaptiveIngestResult> {
  return ingestCsvViaExcelIngester(input, deps);
}
