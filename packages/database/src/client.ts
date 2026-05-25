import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as rawSchema from './schemas/index.js';

/**
 * schemas/index.ts uses `export * as Name from './foo.schema.js'` to
 * disambiguate duplicate symbol names across sibling schemas. The resulting
 * namespace objects are NOT drizzle tables — passing them to `drizzle()`
 * trips `extractTablesRelationalConfig` on a null prototype check inside
 * `is(...)`. Filter the schema to only entries that look like drizzle
 * tables/relations before handing it off.
 *
 * Criterion: drizzle tables and relations expose an internal Symbol
 * `Symbol.for('drizzle:IsDrizzleTable')` OR the relations object marker
 * `Symbol.for('drizzle:Relations')`. We also accept plain-object schema
 * entries with a `$inferSelect` property (pgTable output). Anything else
 * (pure namespace re-exports, enum arrays, plain constants) is skipped.
 */
const DRIZZLE_TABLE_SYMBOL = Symbol.for('drizzle:IsDrizzleTable');
const DRIZZLE_RELATIONS_SYMBOL = Symbol.for('drizzle:Relations');

function isDrizzleSchemaEntry(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object' && typeof value !== 'function') return false;
  // Tables are function-ish (they have a `[Symbol.toString]` builder) — check
  // the marker first, then fall back to duck-typing.
  const v = value as Record<string | symbol, unknown>;
  if (v[DRIZZLE_TABLE_SYMBOL] === true) return true;
  if (v[DRIZZLE_RELATIONS_SYMBOL] === true) return true;
  // Relations objects from `relations()` carry `.config` and `.table`.
  if ('config' in v && 'table' in v) return true;
  // Tables also expose a `Symbol.for('drizzle:Name')` entry — check for it.
  const nameSym = Symbol.for('drizzle:Name');
  if (typeof (v as Record<symbol, unknown>)[nameSym] === 'string') return true;
  return false;
}

function filterSchema(
  rawSchemaInput: Record<string, unknown>
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawSchemaInput)) {
    if (isDrizzleSchemaEntry(value)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export function createDatabaseClient(connectionString: string) {
  const client = postgres(connectionString);
  const schema = filterSchema(rawSchema as Record<string, unknown>);
  return drizzle(client, { schema });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

/**
 * Z5 HA wire — opens a Drizzle client against a read replica.
 *
 * Functionally identical to `createDatabaseClient` today (same Drizzle
 * surface, same schema). Exposed as a distinct factory so the
 * composition root can wire a separate connection pool whose lifetime
 * matches the replica — and so we can later attach replica-specific
 * options (statement_timeout, lower max-pool, etc.) without breaking
 * primary writes.
 */
export function createReadonlyDatabaseClient(connectionString: string) {
  const client = postgres(connectionString);
  const schema = filterSchema(rawSchema as Record<string, unknown>);
  return drizzle(client, { schema });
}
