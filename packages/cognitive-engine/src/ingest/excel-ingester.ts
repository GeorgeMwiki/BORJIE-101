/**
 * Excel ingester — Discipline 6, Excel path.
 *
 * Wraps the caller-supplied `TabularParserPort.parseExcel` adapter
 * (SheetJS in production). After parse: column-type inference, boundary
 * PII redaction on string cells, audit-hash stamping, DataJoinRef
 * registration.
 *
 * @module @borjie/cognitive-engine/ingest/excel-ingester
 */

import type {
  AdaptiveIngestResult,
  ClockPort,
  IngestStoragePort,
  PiiRedaction,
  TabularParserPort,
} from '../types.js';
import { inferAllColumns } from './column-type-inferer.js';
import { redactPii } from './pii-redactor.js';
import { buildDataJoinRef } from './data-join-registrar.js';
import { computeIngestAuditHash } from '../audit/audit-chain-link.js';

export interface IngestExcelInput {
  readonly attachment_id: string;
  readonly tenant_id: string;
  readonly session_id: string;
  readonly bytes: Uint8Array;
  readonly intent_keywords: ReadonlyArray<string>;
  readonly retention_days?: number;
}

export interface IngestExcelDeps {
  readonly parser: TabularParserPort;
  readonly storage: IngestStoragePort;
  readonly clock?: ClockPort;
}

const DEFAULT_RETENTION_DAYS = 14;
const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function ingestExcel(
  input: IngestExcelInput,
  deps: IngestExcelDeps,
): Promise<AdaptiveIngestResult> {
  const { columns, rows } = await deps.parser.parseExcel(input.bytes);
  return finishTabular({
    parsedColumns: columns,
    parsedRows: rows,
    contentType: XLSX_CONTENT_TYPE,
    kind: 'excel',
    input,
    deps,
  });
}

export async function ingestCsvViaExcelIngester(
  input: IngestExcelInput,
  deps: IngestExcelDeps,
): Promise<AdaptiveIngestResult> {
  const { columns, rows } = await deps.parser.parseCsv(input.bytes);
  return finishTabular({
    parsedColumns: columns,
    parsedRows: rows,
    contentType: 'text/csv',
    kind: 'csv',
    input,
    deps,
  });
}

interface FinishInput {
  readonly parsedColumns: ReadonlyArray<string>;
  readonly parsedRows: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly contentType: string;
  readonly kind: 'excel' | 'csv';
  readonly input: IngestExcelInput;
  readonly deps: IngestExcelDeps;
}

async function finishTabular(args: FinishInput): Promise<AdaptiveIngestResult> {
  const now = args.deps.clock?.now() ?? new Date();
  const stored = await args.deps.storage.put({
    tenant_id: args.input.tenant_id,
    session_id: args.input.session_id,
    attachment_id: args.input.attachment_id,
    bytes: args.input.bytes,
    content_type: args.contentType,
  });

  const columns = inferAllColumns(args.parsedColumns, args.parsedRows);
  const allRedactions = collectRedactions(columns, args.parsedRows);

  const join = buildDataJoinRef({
    attachment_id: args.input.attachment_id,
    tenant_id: args.input.tenant_id,
    session_id: args.input.session_id,
    storage_key: stored.storage_key,
    kind: args.kind,
    retention_days: args.input.retention_days ?? DEFAULT_RETENTION_DAYS,
    now,
  });

  const relevance = scoreRelevance(
    columns.map((c) => c.name),
    args.input.intent_keywords,
  );

  const auditHash = computeIngestAuditHash({
    attachment_id: args.input.attachment_id,
    storage_key: stored.storage_key,
    parsed_rows_count: args.parsedRows.length,
    column_names: columns.map((c) => c.name),
    retention_until_iso: join.retention_until_iso,
  });

  return {
    attachment_id: args.input.attachment_id,
    kind: args.kind,
    storage_key: stored.storage_key,
    parsed_columns: columns,
    parsed_rows_count: args.parsedRows.length,
    pii_redactions: allRedactions,
    inferred_data_join_ref: join,
    relevance_to_intent: relevance,
    audit_hash: auditHash,
  };
}

function collectRedactions(
  columns: ReadonlyArray<{ readonly name: string; readonly is_pii: boolean }>,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): ReadonlyArray<PiiRedaction> {
  const result: Array<PiiRedaction> = [];
  for (let i = 0; i < columns.length; i += 1) {
    const col = columns[i];
    if (col === undefined || !col.is_pii) continue;
    const counts = new Map<string, number>();
    for (const row of rows) {
      const cell = row[i];
      if (cell == null) continue;
      const { redactions } = redactPii(String(cell), col.name);
      for (const r of redactions) {
        counts.set(r.pattern_kind, (counts.get(r.pattern_kind) ?? 0) + r.count);
      }
    }
    for (const [kind, count] of counts) {
      result.push({ field_path: col.name, pattern_kind: kind, count });
    }
  }
  return result;
}

function scoreRelevance(
  columnNames: ReadonlyArray<string>,
  keywords: ReadonlyArray<string>,
): number {
  if (keywords.length === 0) return 0.5;
  const haystack = columnNames.join(' ').toLowerCase();
  const hits = keywords.filter((k) => haystack.includes(k.toLowerCase())).length;
  return Math.min(1, hits / Math.max(1, keywords.length));
}
