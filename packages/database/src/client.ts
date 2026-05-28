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

/**
 * Scale-hardening: pool + timeout defaults.
 *
 * postgres-js opens lazy connections up to `max`, recycles idle
 * connections after `idle_timeout`, and rotates long-lived connections
 * after `max_lifetime` so pgBouncer / transaction-pooler upgrade paths
 * never end up pinned to a stale backend session. Every value is
 * env-overridable so an operator can tune per environment without a
 * code change (the documented runbook lives in
 * `Docs/AUDIT/SCALE_RUNBOOK.md`).
 *
 * Statement-timeout is bound on the Postgres session itself so a
 * runaway query is killed by the server even when the Node client
 * fails to abort the socket. Lock-timeout protects against a slow
 * blocked migration silently fanning out into request queues.
 */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function readPoolOptions() {
  return {
    max: parsePositiveInt(process.env.DATABASE_POOL_MAX, 20),
    idle_timeout: parsePositiveInt(process.env.DATABASE_IDLE_TIMEOUT_SEC, 30),
    max_lifetime: parsePositiveInt(
      process.env.DATABASE_MAX_LIFETIME_SEC,
      30 * 60,
    ),
    connect_timeout: parsePositiveInt(
      process.env.DATABASE_CONNECT_TIMEOUT_SEC,
      10,
    ),
    // Session-level GUCs applied on every backend connect. Both timeouts
    // are in milliseconds. Lock-timeout is shorter than statement_timeout
    // so a row-lock contention surfaces as a clean error instead of a
    // dragged-out query. postgres-js takes these as numbers and forwards
    // them as `SET LOCAL` on each new session.
    connection: {
      statement_timeout: parsePositiveInt(
        process.env.DATABASE_STATEMENT_TIMEOUT_MS,
        30_000,
      ),
      lock_timeout: parsePositiveInt(
        process.env.DATABASE_LOCK_TIMEOUT_MS,
        5_000,
      ),
    },
  };
}

export function createDatabaseClient(connectionString: string) {
  const client = postgres(connectionString, readPoolOptions());
  const schema = filterSchema(rawSchema as Record<string, unknown>);
  return drizzle(client, { schema });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

/**
 * Z5 HA wire — opens a Drizzle client against a read replica.
 *
 * Read replicas typically tolerate a smaller pool (read traffic is
 * lighter per connection) and a tighter statement timeout (reporting
 * queries shouldn't drag), so the env-driven defaults differ from the
 * primary. When the replica vars are unset we fall back to the primary
 * pool config so existing single-DB deployments keep working unchanged.
 */
function readReadonlyPoolOptions() {
  const primary = readPoolOptions();
  return {
    max: parsePositiveInt(
      process.env.DATABASE_READONLY_POOL_MAX,
      Math.max(5, Math.floor(primary.max / 2)),
    ),
    idle_timeout: primary.idle_timeout,
    max_lifetime: primary.max_lifetime,
    connect_timeout: primary.connect_timeout,
    connection: {
      statement_timeout: parsePositiveInt(
        process.env.DATABASE_READONLY_STATEMENT_TIMEOUT_MS,
        15_000,
      ),
      lock_timeout: primary.connection.lock_timeout,
    },
  };
}

export function createReadonlyDatabaseClient(connectionString: string) {
  const client = postgres(connectionString, readReadonlyPoolOptions());
  const schema = filterSchema(rawSchema as Record<string, unknown>);
  return drizzle(client, { schema });
}
