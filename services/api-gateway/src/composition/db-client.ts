/**
 * Singleton Drizzle client accessor.
 *
 * Reads DATABASE_URL from the environment and memoizes a single
 * postgres-js-backed Drizzle client. Callers must guard against the
 * null return — when DATABASE_URL is unset we do not initialize a
 * client; this lets the api-gateway boot in environments without a
 * Postgres reachable (tests, local dev smoke).
 *
 * This module is intentionally separate from ../middleware/database.ts
 * which serves the request-scoped hono middleware. They share the same
 * underlying client lazily via getDb() below so we never open two
 * connection pools in the same process.
 */

import {
  createDatabaseClient,
  createReadonlyDatabaseClient,
  getSharedDatabaseClient,
  readPoolMode,
} from '@borjie/database';
import { logger } from '../utils/logger.js';

// NOTE: we deliberately avoid importing the named `DatabaseClient` type
// from `@borjie/database` because its name collides with a namespace
// that drizzle-orm/postgres-js's declaration merging pulls in at this
// consumption site. Deriving the type via ReturnType sidesteps that.
type DrizzleClient = ReturnType<typeof createDatabaseClient>;

// Same collision sidestep for the pool-mode literal union: the barrel's
// `export *` surface re-exports a value/namespace named `DatabasePoolMode`
// at this consumption site, so importing it as a type triggers TS2709.
// Derive it from the `readPoolMode()` return type instead (it is the
// canonical `'session' | 'transaction'` union).
type DatabasePoolMode = ReturnType<typeof readPoolMode>;

/**
 * Resolved DB pool mode for this process, captured at {@link initDbClient}.
 * `null` until the init fn runs (the legacy getDb()/getDbReadonly() lazy paths
 * read env directly via the @borjie/database factories, so this is purely
 * informational for logging + the integration phase). Read ONCE at bootstrap.
 */
let resolvedPoolMode: DatabasePoolMode | null = null;

let cachedClient: DrizzleClient | null = null;
let initialized = false;

let cachedReadonlyClient: DrizzleClient | null = null;
let readonlyInitialized = false;

/**
 * Return the memoized Drizzle client, initializing it on first call.
 * Returns null when DATABASE_URL is not configured — composition root
 * decides how to handle that (typically: skip service registration and
 * let individual routes return 503).
 */
export function getDb(): DrizzleClient | null {
  if (initialized) return cachedClient;
  initialized = true;

  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    cachedClient = null;
    return null;
  }

  try {
    // RSS-04 — route through the single bounded shared pool of record so this
    // process never opens a second pool for the same URL. Memoised by conn
    // string inside @borjie/database, so other (integration-wired) call-sites
    // that ask for the same URL get this exact client, not a new pool.
    cachedClient = getSharedDatabaseClient(url);
    return cachedClient;
  } catch (error) {
    // Leave cachedClient null so callers fall back to degraded mode.
    // A production deployment must have DATABASE_URL set; lower envs
    // may not. Error is surfaced to the caller to log.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`db-client: failed to initialize Drizzle client: ${message}`);
  }
}

/**
 * Z5 HA wire — return a Drizzle client routed against the read replica.
 *
 * Env decision tree:
 *   - DATABASE_URL unset                                → returns null
 *   - DATABASE_URL_READONLY unset                       → alias of getDb()
 *   - DATABASE_URL_READONLY === DATABASE_URL            → alias of getDb()
 *   - DATABASE_URL_READONLY set and distinct            → separate pool
 *   - replica factory throws                            → fall back to primary,
 *                                                          warn once
 */
export function getDbReadonly(): DrizzleClient | null {
  if (readonlyInitialized) return cachedReadonlyClient;
  readonlyInitialized = true;

  const primaryUrl = process.env.DATABASE_URL?.trim();
  if (!primaryUrl) {
    cachedReadonlyClient = null;
    return null;
  }

  const replicaUrl = process.env.DATABASE_URL_READONLY?.trim();
  // No distinct replica configured → alias the primary so callers share the
  // same pool and we never open a second connection.
  if (!replicaUrl || replicaUrl === primaryUrl) {
    cachedReadonlyClient = getDb();
    return cachedReadonlyClient;
  }

  try {
    // Distinct replica URL → its own single pool, memoised by conn string so a
    // repeat lookup never opens a second replica pool. We use the readonly
    // factory (tighter timeouts / smaller pool) explicitly here rather than the
    // shared-primary memo, because the replica wants different pool options.
    cachedReadonlyClient = createReadonlyDatabaseClient(replicaUrl);
    return cachedReadonlyClient;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console -- HA visibility: surfaces replica
    // misconfiguration on boot so operators see it in the deploy logs.
    logger.warn(`db-client: read-replica init failed (${message}); falling back to primary`);
    cachedReadonlyClient = getDb();
    return cachedReadonlyClient;
  }
}

/**
 * Result of {@link initDbClient} — what the integration phase needs to wire the
 * rest of the gateway onto the single shared pool, plus the resolved mode for
 * boot-time logging / health surfacing.
 */
export interface DbClientInit {
  /** The single shared primary Drizzle client (or null when DATABASE_URL unset). */
  readonly db: DrizzleClient | null;
  /** The read-replica client (aliases primary when no distinct replica URL). */
  readonly readonlyDb: DrizzleClient | null;
  /** Resolved pool mode — 'session' (default) | 'transaction'. */
  readonly poolMode: DatabasePoolMode;
}

/**
 * Bootstrap-time init/wiring entry point for the DB client lane (RSS-03/04).
 *
 * The integration phase calls THIS once at boot (NOT the shared composition
 * root, which this lane does not touch). It:
 *   - reads `DATABASE_POOL_MODE` ONCE (the only place this lane reads it at the
 *     gateway level — honouring "no process.env outside bootstrap"),
 *   - eagerly materialises the single shared primary + readonly clients so the
 *     one bounded pool is the factory of record before the first request,
 *   - logs the resolved mode so an operator sees in the deploy logs whether the
 *     transaction-pooler-safe path is active.
 *
 * Idempotent: safe to call more than once (the underlying clients are memoised
 * by connection string). Returns the wired handles for the integration phase.
 *
 * DEFAULT BEHAVIOUR: with no env set, `poolMode` resolves to `'session'`, the
 * shared pool uses today's exact postgres-js options, and nothing about request
 * handling changes — merging this lane is a no-op until DATABASE_POOL_MODE is
 * flipped to `'transaction'` by an operator.
 */
export function initDbClient(): DbClientInit {
  resolvedPoolMode = readPoolMode();
  const db = getDb();
  const readonlyDb = getDbReadonly();

  logger.info(
    {
      poolMode: resolvedPoolMode,
      hasPrimary: db !== null,
      hasReadReplica:
        readonlyDb !== null && readonlyDb !== db ? true : false,
    },
    'db-client: initialised shared pool ' +
      `(mode=${resolvedPoolMode}; ` +
      `${resolvedPoolMode === 'transaction'
        ? 'per-tx SET LOCAL RLS, prepared statements off'
        : 'reserve-pin RLS, prepared statements on — current behaviour'})`,
  );

  return { db, readonlyDb, poolMode: resolvedPoolMode };
}

/** The mode resolved by {@link initDbClient}, or null before it has run. */
export function getResolvedPoolMode(): DatabasePoolMode | null {
  return resolvedPoolMode;
}

/** Test-only: reset the memo so unit tests can swap env. */
export function __resetDbClientForTests(): void {
  cachedClient = null;
  initialized = false;
  cachedReadonlyClient = null;
  readonlyInitialized = false;
  resolvedPoolMode = null;
}
