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

/**
 * Pool mode — the master switch for RSS-03/RSS-04.
 *
 *   'session'      (DEFAULT) — TODAY's exact behaviour. Prepared statements
 *                  stay ON (postgres-js default), `withReservedConnection`
 *                  pins one backend per request and binds a session-scoped
 *                  tenant GUC. Correct on a SESSION pooler / direct connection.
 *
 *   'transaction'  — Supabase/pgbouncer transaction-mode-safe path. Disables
 *                  prepared statements and type-introspection (both rebind to
 *                  a different backend mid-session under the transaction
 *                  pooler), so every DB unit-of-work MUST bind its tenant GUC
 *                  with `SET LOCAL` inside a short transaction
 *                  (`withTenantContext`). The transaction pooler guarantees one
 *                  transaction is served end-to-end by one backend, so the
 *                  `SET LOCAL` GUC is correct by construction and is discarded
 *                  at COMMIT — it can never bleed onto the next transaction the
 *                  pooler routes to that backend.
 *
 * Read ONCE at module load (consistent with the other `client.ts` env reads;
 * never re-read per request). The default is `'session'` so MERGING this code
 * changes NOTHING at runtime until an operator sets DATABASE_POOL_MODE.
 *
 * `DATABASE_PREPARE` is an independent escape hatch: an operator on a dedicated
 * session pooler running in transaction mode could force prepared statements
 * back on. It only takes effect in transaction mode (session mode never
 * touches `prepare`, preserving byte-for-byte current behaviour).
 */
export type DatabasePoolMode = 'session' | 'transaction';

export function readPoolMode(): DatabasePoolMode {
  return process.env.DATABASE_POOL_MODE === 'transaction'
    ? 'transaction'
    : 'session';
}

/**
 * Transaction-pooler safety toggles, applied ONLY in `'transaction'` mode.
 *
 *   - `prepare: false` — pgbouncer/Supavisor reject named prepared statements
 *     in transaction mode (a rebind to another backend loses the plan handle
 *     → `prepared statement "s_x" does not exist`). The migration runner
 *     already proves this is safe (`run-migrations.ts` sets `prepare:false`).
 *   - `fetch_types: false` — postgres-js otherwise issues a type-introspection
 *     round-trip on connect that also breaks under aggressive transaction
 *     rebinding.
 *
 * `DATABASE_PREPARE=true` re-enables prepared statements (operator opt-in for a
 * dedicated session pooler that still wants transaction-style GUC binding).
 *
 * In `'session'` mode this returns an EMPTY object so the options handed to
 * postgres-js are byte-for-byte identical to today (no `prepare`/`fetch_types`
 * keys at all → postgres-js defaults preserved).
 */
function transactionModeOptions(
  mode: DatabasePoolMode,
): { prepare?: boolean; fetch_types?: boolean } {
  if (mode !== 'transaction') return {};
  const prepare = process.env.DATABASE_PREPARE === 'true';
  return { prepare, fetch_types: prepare };
}

export function readPoolOptions(maxOverride?: number) {
  const mode = readPoolMode();
  return {
    // `maxOverride` lets a caller open a SMALL dedicated pool (e.g. the
    // out-of-band service-role worker pool) sized independently of the main
    // request pool, so a fixed connection budget stays under the Supabase
    // session-pooler client ceiling. Falls back to DATABASE_POOL_MAX.
    max:
      maxOverride && maxOverride > 0
        ? maxOverride
        : parsePositiveInt(process.env.DATABASE_POOL_MAX, 20),
    idle_timeout: parsePositiveInt(process.env.DATABASE_IDLE_TIMEOUT_SEC, 30),
    max_lifetime: parsePositiveInt(
      process.env.DATABASE_MAX_LIFETIME_SEC,
      30 * 60,
    ),
    connect_timeout: parsePositiveInt(
      process.env.DATABASE_CONNECT_TIMEOUT_SEC,
      10,
    ),
    // Transaction-pooler safety toggles — empty (no-op) in session mode.
    ...transactionModeOptions(mode),
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

/**
 * The drizzle-usable schema, filtered ONCE at module load. Both the
 * primary/readonly client factories and `withReservedConnection` reuse this
 * exact object so a reserved-connection Drizzle instance carries the same
 * relational config as the pooled one.
 */
const FILTERED_SCHEMA = filterSchema(rawSchema as Record<string, unknown>);

export function createDatabaseClient(
  connectionString: string,
  maxOverride?: number,
) {
  const client = postgres(connectionString, readPoolOptions(maxOverride));
  return drizzle(client, { schema: FILTERED_SCHEMA });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

/**
 * RSS-04 — ONE shared bounded pool of record per process.
 *
 * Historically several call-sites each called `createDatabaseClient(url)` and
 * opened an INDEPENDENT postgres-js pool (`max:20` each); multiplied by
 * replicas this overruns the pooler's client ceiling. `getSharedDatabaseClient`
 * memoises one Drizzle client per distinct connection string so every consumer
 * in the process shares a single bounded pool. The composition root wires its
 * `getDb()` accessor through this factory (see
 * `services/api-gateway/src/composition/db-client.ts:initDbClient`).
 *
 * Keyed by connection string so a primary and a distinct read-replica URL each
 * get their own (still single) pool; passing the same URL twice returns the
 * exact same client instance — never a second pool.
 */
const SHARED_CLIENTS = new Map<string, DatabaseClient>();

export function getSharedDatabaseClient(
  connectionString: string,
): DatabaseClient {
  const existing = SHARED_CLIENTS.get(connectionString);
  if (existing) return existing;
  const client = createDatabaseClient(connectionString);
  SHARED_CLIENTS.set(connectionString, client);
  return client;
}

/**
 * Test-only: drop the shared-client memo so a unit test can swap env (pool
 * mode / prepare) and observe a fresh pool. Closing the underlying postgres-js
 * sockets is the caller's concern in integration tests; unit tests that never
 * connect can call this freely.
 */
export function __resetSharedDatabaseClientsForTests(): void {
  SHARED_CLIENTS.clear();
}

/**
 * @deprecated TRANSACTION-POOLER-UNSAFE. Retained ONLY for the session-pooler
 * opt-in path (`DATABASE_POOL_MODE=session`, the default). On the Supabase
 * transaction pooler (`:6543`) the reserved handle is a *client→pooler* lease,
 * not a *pooler→backend* pin: a session-scoped GUC set on backend A can be read
 * by a later statement the pooler routes to backend B, so this path is unsafe
 * there. In `transaction` mode use `withTenantContext` (per-tx `SET LOCAL`)
 * instead — its GUC is correct by construction because one transaction is
 * served end-to-end by one backend and the `SET LOCAL` is discarded at COMMIT.
 *
 * Run `fn` against a Drizzle client bound to a SINGLE, EXCLUSIVELY-RESERVED
 * pool connection — the foundation of request-scoped RLS connection pinning.
 *
 * Why this exists
 * ───────────────
 * postgres.js checks out a connection PER STATEMENT. Binding the RLS tenant
 * GUC with `set_config('app.current_tenant_id', t, false)` on the pooled
 * client and then reading as a separate statement can land the read on a
 * DIFFERENT backend connection — one whose GUC was last set by another
 * tenant's request. Under concurrent multi-tenant load that leaks rows
 * across tenants (RLS evaluates the stale GUC). `sql.reserve()` hands back a
 * connection held exclusively until `release()`, so the caller can bind the
 * GUC and run every subsequent statement on that one connection with no
 * interleaving.
 *
 * This deliberately keeps today's per-statement write atomicity (it is NOT a
 * request-wide transaction): the caller still issues independent
 * auto-committed statements — they simply all run on the reserved connection.
 * That matters because request handlers interleave DB work with long
 * external calls (LLM / payments / calendar); a request-wide transaction
 * would hold the connection across those round-trips and exhaust the pool.
 *
 * Lifecycle (security-critical)
 * ─────────────────────────────
 * The caller binds the GUC(s) it needs on `reqDb` (canonical
 * `app.current_tenant_id`, and downstream middleware may add
 * `app.current_person_id`). On the way out — success OR throw — every app.*
 * GUC this request path can set is reset to a safe default before the
 * connection returns to the pool. The next reservation re-binds the tenant
 * GUC before any read, but `app.current_person_id` / `app.is_service_role`
 * are NOT guaranteed to be re-bound by every consumer, so resetting them
 * here is what prevents a lingering person-scope / service-role bypass on a
 * recycled connection. We do NOT use `DISCARD ALL` — it would drop the
 * prepared-statement cache postgres.js relies on.
 */
/**
 * postgres.js `reserve()` hands back a bare tagged-template `Sql` bound to
 * one connection. It carries `.unsafe` but NOT the `.options` Drizzle's
 * `construct` reads (parsers/serializers) nor the `.begin`/`.savepoint` a
 * Drizzle `.transaction()` calls — those live only on the top-level pool
 * client. We graft them on so `drizzle(reserved)` is a fully-functional
 * client whose EVERY statement — including transactions — runs on the one
 * reserved connection that carries the tenant GUC. Crucially, `begin`/
 * `savepoint` are emulated ON the reserved connection (BEGIN/COMMIT as
 * statements) rather than delegated to the pool's `begin`, which would open
 * the transaction on a DIFFERENT pooled connection and lose the GUC.
 */
interface ReservedClientGrafts {
  options: unknown;
  unsafe: (query: string, params?: unknown[]) => Promise<unknown>;
  begin: (a: unknown, b?: unknown) => Promise<unknown>;
  savepoint: (a: unknown, b?: unknown) => Promise<unknown>;
}

function reservedToDrizzle(
  poolClient: { options: unknown },
  reserved: Awaited<ReturnType<DatabaseClient['$client']['reserve']>>,
): DatabaseClient {
  const r = reserved as unknown as ReservedClientGrafts;
  // Share the pool's options object — Drizzle mutates only a fixed set of
  // type parsers/serializers, idempotently, so sharing is safe.
  r.options = poolClient.options;
  let savepointSeq = 0;
  const pickFn = (a: unknown, b: unknown): ((client: unknown) => Promise<unknown>) =>
    (typeof a === 'function' ? a : b) as (client: unknown) => Promise<unknown>;
  r.begin = async (a, b) => {
    const fn = pickFn(a, b);
    await r.unsafe('begin');
    try {
      const result = await fn(reserved);
      await r.unsafe('commit');
      return result;
    } catch (err) {
      try {
        await r.unsafe('rollback');
      } catch {
        // Connection may already be aborted; the original error wins.
      }
      throw err;
    }
  };
  r.savepoint = async (a, b) => {
    const fn = pickFn(a, b);
    const name = `drizzle_sp_${savepointSeq++}`;
    await r.unsafe(`savepoint ${name}`);
    try {
      const result = await fn(reserved);
      await r.unsafe(`release savepoint ${name}`);
      return result;
    } catch (err) {
      try {
        await r.unsafe(`rollback to savepoint ${name}`);
      } catch {
        // Savepoint rollback failed; the original error wins.
      }
      throw err;
    }
  };
  return drizzle(reserved as unknown as ReturnType<typeof postgres>, {
    schema: FILTERED_SCHEMA,
  }) as unknown as DatabaseClient;
}

export async function withReservedConnection<T>(
  db: DatabaseClient,
  fn: (reqDb: DatabaseClient) => Promise<T>,
): Promise<T> {
  const reserved = await db.$client.reserve();
  try {
    const reqDb = reservedToDrizzle(
      db.$client as unknown as { options: unknown },
      reserved,
    );
    return await fn(reqDb);
  } finally {
    // Tenant-GUC bleed defence (RSS-03). This path uses session-scoped
    // `set_config(..., false)` GUCs bound on the reserved backend. If the
    // reset SELECT below fails, the connection would otherwise be
    // `release()`d back to the pool STILL CARRYING this request's tenant /
    // service-role GUC — a later borrow of that backend could then read it
    // and leak rows across tenants. So on reset failure we EVICT the
    // connection from the pool via `.end()` instead of releasing it, making
    // a stale session GUC impossible to inherit. (The happy path still
    // `release()`s for reuse; only the failure path pays the reconnect cost.)
    let resetOk = false;
    try {
      await reserved`SELECT
        set_config('app.current_tenant_id', '', false),
        set_config('app.tenant_id', '', false),
        set_config('app.current_person_id', '', false),
        set_config('app.is_service_role', 'false', false)`;
      resetOk = true;
    } catch {
      resetOk = false;
    }
    if (resetOk) {
      reserved.release();
    } else {
      // Destroy the backend rather than return a GUC-poisoned connection to
      // the pool. `.end()` is on the Sql surface ReservedSql extends.
      try {
        await (reserved as unknown as { end: () => Promise<void> }).end();
      } catch {
        // If even eviction fails, fall back to release — better than leaking
        // the handle; the next reservation re-binds the tenant GUC before any
        // read so a stale value cannot surface another tenant's rows.
        reserved.release();
      }
    }
  }
}

/**
 * Z5 HA wire — opens a Drizzle client against a read replica.
 *
 * Read replicas typically tolerate a smaller pool (read traffic is
 * lighter per connection) and a tighter statement timeout (reporting
 * queries shouldn't drag), so the env-driven defaults differ from the
 * primary. When the replica vars are unset we fall back to the primary
 * pool config so existing single-DB deployments keep working unchanged.
 */
export function readReadonlyPoolOptions() {
  const primary = readPoolOptions();
  const mode = readPoolMode();
  return {
    max: parsePositiveInt(
      process.env.DATABASE_READONLY_POOL_MAX,
      Math.max(5, Math.floor(primary.max / 2)),
    ),
    idle_timeout: primary.idle_timeout,
    max_lifetime: primary.max_lifetime,
    connect_timeout: primary.connect_timeout,
    // The replica sits behind the same pooler, so it inherits the same
    // transaction-mode toggles (empty/no-op in session mode).
    ...transactionModeOptions(mode),
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
  return drizzle(client, { schema: FILTERED_SCHEMA });
}
