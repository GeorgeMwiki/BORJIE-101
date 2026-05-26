/**
 * Stage 4.b — Drizzle delta builder.
 *
 * Emits a TypeScript snippet that the migration writer can paste into
 * the affected schema file. Production-ready Drizzle deltas are
 * generated as pgTable column additions; the writer wraps them in a
 * `// >>> 18U add_column delta <<<` marker so reviewers can spot them.
 */

import type { DiscoveredColumn, InferredType } from '../types.js';

const DRIZZLE_BY_INFERRED: Readonly<Record<InferredType, string>> = Object.freeze({
  string: "text('__COL__')",
  number: "numeric('__COL__')",
  date: "date('__COL__')",
  datetime: "timestamp('__COL__', { withTimezone: true })",
  boolean: "boolean('__COL__')",
  enum: "text('__COL__')",
  email: "text('__COL__')",
  phone: "text('__COL__')",
  nida: "text('__COL__')",
  tin: "text('__COL__')",
  coordinate: "text('__COL__')",
  url: "text('__COL__')",
});

function camelCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .split('_')
    .filter((seg) => seg.length > 0)
    .map((seg, i) =>
      i === 0 ? seg : seg.charAt(0).toUpperCase() + seg.slice(1),
    )
    .join('');
}

function snakeCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
}

export function buildAddColumnDelta(column: DiscoveredColumn): string {
  const snake = snakeCase(column.name);
  const camel = camelCase(column.name);
  const template = DRIZZLE_BY_INFERRED[column.inferred_type];
  const expr = template.replace('__COL__', snake);
  const not_null = column.nullability > 0 ? '' : '.notNull()';
  return `  ${camel}: ${expr}${not_null},`;
}

export function buildAddTableDelta(
  table_camel: string,
  table_snake: string,
  columns: ReadonlyArray<DiscoveredColumn>,
): string {
  const lines = columns.map(buildAddColumnDelta);
  return [
    `export const ${camelCase(table_camel)} = pgTable('${snakeCase(table_snake)}', {`,
    `  id: uuid('id').primaryKey().defaultRandom(),`,
    `  tenantId: text('tenant_id').notNull(),`,
    ...lines,
    '});',
  ].join('\n');
}

export const __TEST_ONLY = Object.freeze({ camelCase, snakeCase });
