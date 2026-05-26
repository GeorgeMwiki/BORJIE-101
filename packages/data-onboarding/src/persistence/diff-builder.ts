/**
 * Stage 5.a — Persist-diff builder.
 *
 * Compares inbound rows against existing rows (keyed by the resolved
 * primary key) and emits an owner-facing preview of insert / update /
 * skip outcomes. Pure function — the persister consumes this preview
 * after owner approval.
 */

import type { Row, PersistOperation } from '../types.js';

export interface RowDiffEntry {
  readonly source_row_number: number;
  readonly key_value: string;
  readonly operation: PersistOperation;
  readonly changed_fields?: ReadonlyArray<{
    readonly field: string;
    readonly from: unknown;
    readonly to: unknown;
  }>;
}

export interface DiffPreview {
  readonly inserts: ReadonlyArray<RowDiffEntry>;
  readonly updates: ReadonlyArray<RowDiffEntry>;
  readonly skips: ReadonlyArray<RowDiffEntry>;
  readonly counts: { readonly insert: number; readonly update: number; readonly skip: number };
}

export interface ExistingRowSnapshot {
  readonly key_value: string;
  readonly values: Readonly<Record<string, unknown>>;
}

function isEqualShallow(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return String(a).trim() === String(b).trim();
}

export function buildDiff(
  rows: ReadonlyArray<Row>,
  primary_key_field: string,
  existing: ReadonlyArray<ExistingRowSnapshot>,
): DiffPreview {
  const existing_by_key = new Map<string, ExistingRowSnapshot>();
  for (const e of existing) {
    existing_by_key.set(e.key_value, e);
  }

  const inserts: RowDiffEntry[] = [];
  const updates: RowDiffEntry[] = [];
  const skips: RowDiffEntry[] = [];

  for (const row of rows) {
    const raw_key = row.values[primary_key_field];
    const key_value = raw_key === undefined || raw_key === null
      ? ''
      : String(raw_key);
    if (key_value.length === 0) {
      skips.push(
        Object.freeze({
          source_row_number: row.source_row_number,
          key_value,
          operation: 'skip' as const,
        }),
      );
      continue;
    }
    const ex = existing_by_key.get(key_value);
    if (ex === undefined) {
      inserts.push(
        Object.freeze({
          source_row_number: row.source_row_number,
          key_value,
          operation: 'insert' as const,
        }),
      );
      continue;
    }
    const changed: { field: string; from: unknown; to: unknown }[] = [];
    for (const [k, v] of Object.entries(row.values)) {
      if (k === primary_key_field) continue;
      const from = ex.values[k];
      if (!isEqualShallow(from, v)) {
        changed.push({ field: k, from, to: v });
      }
    }
    if (changed.length === 0) {
      skips.push(
        Object.freeze({
          source_row_number: row.source_row_number,
          key_value,
          operation: 'skip' as const,
        }),
      );
    } else {
      updates.push(
        Object.freeze({
          source_row_number: row.source_row_number,
          key_value,
          operation: 'update' as const,
          changed_fields: Object.freeze(
            changed.map((c) => Object.freeze({ ...c })),
          ),
        }),
      );
    }
  }

  return Object.freeze({
    inserts: Object.freeze(inserts),
    updates: Object.freeze(updates),
    skips: Object.freeze(skips),
    counts: Object.freeze({
      insert: inserts.length,
      update: updates.length,
      skip: skips.length,
    }),
  });
}
