/**
 * Stage 5.b — Row persister.
 *
 * Drives the actual UPSERT against the tenant's target table after
 * owner approval. The package itself is I/O-free; the runtime
 * supplies a `RowWriter` that wraps the tenant-scoped Drizzle client.
 *
 * Audit hashes are produced via @borjie/audit-hash-chain so every
 * persisted row is link-verifiable against the tenant's audit chain.
 */

import { hashChainEntry } from '@borjie/audit-hash-chain';
import type {
  AppliedSchema,
  PersistResult,
  PersistedRow,
  Row,
} from '../types.js';
import type { ProvenanceEntry, ProvenanceWriter } from './row-provenance-writer.js';

export interface RowWriter {
  upsertRow(args: {
    readonly table: string;
    readonly primary_key_field: string;
    readonly values: Readonly<Record<string, unknown>>;
  }): Promise<{ row_id: string; operation: 'insert' | 'update' | 'skip' }>;
}

export interface PersistArgs {
  readonly rows: ReadonlyArray<Row>;
  readonly approved_schema: AppliedSchema;
  readonly writer: RowWriter;
  readonly provenance: ProvenanceWriter;
  readonly session_id: string;
  readonly tenant_id: string;
  readonly source_file_name: string | null;
  readonly source_sheet: string | null;
}

function projectValues(
  row: Row,
  approved_schema: AppliedSchema,
): Readonly<Record<string, unknown>> {
  const projected: Record<string, unknown> = {};
  for (const m of approved_schema.column_mappings) {
    projected[m.target_field] = row.values[m.source_column];
  }
  return Object.freeze(projected);
}

export async function persistRows(args: PersistArgs): Promise<PersistResult> {
  const persisted: PersistedRow[] = [];
  const provenance: ProvenanceEntry[] = [];

  let rows_inserted = 0;
  let rows_updated = 0;
  let rows_skipped = 0;

  for (const row of args.rows) {
    const values = projectValues(row, args.approved_schema);
    const write_outcome = await args.writer.upsertRow({
      table: args.approved_schema.target_table.table,
      primary_key_field: args.approved_schema.primary_key_field,
      values,
    });

    const audit_payload = Object.freeze({
      session_id: args.session_id,
      tenant_id: args.tenant_id,
      table: args.approved_schema.target_table.table,
      row_id: write_outcome.row_id,
      operation: write_outcome.operation,
      values_snapshot: values,
    });
    const audit_hash = hashChainEntry({
      payload: audit_payload,
      secretId: 'data_onboarding_v1',
    });

    persisted.push(
      Object.freeze({
        target_row_id: write_outcome.row_id,
        source_row_number: row.source_row_number,
        operation: write_outcome.operation,
        audit_hash,
      }),
    );

    if (write_outcome.operation === 'insert') rows_inserted += 1;
    else if (write_outcome.operation === 'update') rows_updated += 1;
    else rows_skipped += 1;

    provenance.push(
      Object.freeze({
        tenant_id: args.tenant_id,
        target_table: args.approved_schema.target_table.table,
        target_row_id: write_outcome.row_id,
        source_session_id: args.session_id,
        source_file_name: args.source_file_name,
        source_sheet: args.source_sheet,
        source_row_number: row.source_row_number,
        operation: write_outcome.operation,
        audit_hash,
      }),
    );
  }

  await args.provenance.writeBatch(provenance);

  const result_payload = Object.freeze({
    session_id: args.session_id,
    table: args.approved_schema.target_table.table,
    rows_inserted,
    rows_updated,
    rows_skipped,
  });
  const result_hash = hashChainEntry({
    payload: result_payload,
    secretId: 'data_onboarding_v1',
  });

  return Object.freeze({
    target_table: args.approved_schema.target_table.table,
    rows_inserted,
    rows_updated,
    rows_skipped,
    persisted_rows: Object.freeze(persisted),
    audit_hash: result_hash,
  });
}

/**
 * In-memory writer for tests. Generates incremental row ids and
 * remembers every upsert for inspection.
 */
export function createInMemoryRowWriter(): RowWriter & {
  readonly history: () => ReadonlyArray<{
    readonly table: string;
    readonly operation: 'insert' | 'update' | 'skip';
    readonly row_id: string;
    readonly values: Readonly<Record<string, unknown>>;
  }>;
} {
  const log: {
    table: string;
    operation: 'insert' | 'update' | 'skip';
    row_id: string;
    values: Readonly<Record<string, unknown>>;
  }[] = [];
  let n = 0;
  return Object.freeze({
    async upsertRow(input: {
      readonly table: string;
      readonly primary_key_field: string;
      readonly values: Readonly<Record<string, unknown>>;
    }) {
      n += 1;
      const row_id = `mem_${n}`;
      const entry = Object.freeze({
        table: input.table,
        operation: 'insert' as const,
        row_id,
        values: input.values,
      });
      log.push(entry);
      return Object.freeze({ row_id, operation: entry.operation });
    },
    history: () => Object.freeze([...log]),
  });
}
