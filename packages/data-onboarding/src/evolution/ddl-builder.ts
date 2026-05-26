/**
 * Stage 4.a — DDL builder.
 *
 * Generates idempotent SQL DDL for the four currently-supported
 * evolution kinds: add_column, add_table, add_index, modify_column.
 * Output strings are suitable for direct inclusion in a migration
 * file once approved. Identifiers are sanitised; arbitrary SQL is
 * never interpolated.
 */

import type { DiscoveredColumn, InferredType } from '../types.js';

const SQL_TYPE_BY_INFERRED: Readonly<Record<InferredType, string>> =
  Object.freeze({
    string: 'text',
    number: 'numeric',
    date: 'date',
    datetime: 'timestamptz',
    boolean: 'boolean',
    enum: 'text',
    email: 'text',
    phone: 'text',
    nida: 'text',
    tin: 'text',
    coordinate: 'text',
    url: 'text',
  });

function sanitiseIdentifier(s: string): string {
  const trimmed = s.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (trimmed.length === 0 || /^[0-9]/.test(trimmed)) {
    return `c_${trimmed}`;
  }
  return trimmed;
}

export function buildAddColumnDdl(
  table: string,
  column: DiscoveredColumn,
): string {
  const ident = sanitiseIdentifier(column.name);
  const sql_type = SQL_TYPE_BY_INFERRED[column.inferred_type];
  const nullability = column.nullability > 0 ? '' : ' NOT NULL';
  return `ALTER TABLE ${sanitiseIdentifier(table)} ADD COLUMN IF NOT EXISTS ${ident} ${sql_type}${nullability};`;
}

export function buildAddTableDdl(
  table: string,
  columns: ReadonlyArray<DiscoveredColumn>,
  primary_key: string | null,
): string {
  const ident = sanitiseIdentifier(table);
  const lines = columns.map((c) => {
    const t = SQL_TYPE_BY_INFERRED[c.inferred_type];
    const not_null = c.nullability > 0 ? '' : ' NOT NULL';
    return `  ${sanitiseIdentifier(c.name)} ${t}${not_null}`;
  });
  if (primary_key !== null) {
    lines.push(`  PRIMARY KEY (${sanitiseIdentifier(primary_key)})`);
  }
  return [
    `CREATE TABLE IF NOT EXISTS ${ident} (`,
    `  id uuid DEFAULT gen_random_uuid(),`,
    `  tenant_id text NOT NULL,`,
    ...lines.map((l) => `${l},`).slice(0, -1),
    lines.length > 0 ? lines[lines.length - 1] ?? '' : '',
    ');',
  ]
    .filter((s) => s.length > 0)
    .join('\n');
}

export function buildAddIndexDdl(table: string, column: string): string {
  const t = sanitiseIdentifier(table);
  const c = sanitiseIdentifier(column);
  return `CREATE INDEX IF NOT EXISTS ${t}_${c}_idx ON ${t}(${c});`;
}

export function buildModifyColumnDdl(
  table: string,
  column: string,
  new_inferred_type: InferredType,
): string {
  const t = sanitiseIdentifier(table);
  const c = sanitiseIdentifier(column);
  const sql_type = SQL_TYPE_BY_INFERRED[new_inferred_type];
  return `ALTER TABLE ${t} ALTER COLUMN ${c} TYPE ${sql_type} USING ${c}::${sql_type};`;
}

export const __TEST_ONLY = Object.freeze({ sanitiseIdentifier });
