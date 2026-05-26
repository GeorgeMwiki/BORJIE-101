/**
 * Stage 5.c — Row-provenance writer.
 *
 * Records the (target_table, target_row_id) ↔ (source_file, sheet,
 * row_number) link plus the audit hash for every persisted row. The
 * package itself is I/O-free; production wiring binds a Drizzle-
 * backed implementation that inserts into
 * `data_onboarding_row_provenance`.
 */

import type { PersistOperation } from '../types.js';

export interface ProvenanceEntry {
  readonly tenant_id: string;
  readonly target_table: string;
  readonly target_row_id: string;
  readonly source_session_id: string;
  readonly source_file_name: string | null;
  readonly source_sheet: string | null;
  readonly source_row_number: number;
  readonly operation: PersistOperation;
  readonly audit_hash: string;
}

export interface ProvenanceWriter {
  write(entry: ProvenanceEntry): Promise<void>;
  writeBatch(entries: ReadonlyArray<ProvenanceEntry>): Promise<void>;
}

/**
 * In-memory writer for tests + composition. Exposes `.entries()` to
 * inspect what was written.
 */
export function createInMemoryProvenanceWriter(): ProvenanceWriter & {
  readonly entries: () => ReadonlyArray<ProvenanceEntry>;
} {
  const log: ProvenanceEntry[] = [];
  return Object.freeze({
    async write(entry: ProvenanceEntry) {
      log.push(Object.freeze({ ...entry }));
    },
    async writeBatch(entries: ReadonlyArray<ProvenanceEntry>) {
      for (const e of entries) log.push(Object.freeze({ ...e }));
    },
    entries: () => Object.freeze([...log]),
  });
}
