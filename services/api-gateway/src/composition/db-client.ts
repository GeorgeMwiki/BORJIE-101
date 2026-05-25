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
} from '@borjie/database';
import { logger } from '../utils/logger.js';

// NOTE: we deliberately avoid importing the named `DatabaseClient` type
// from `@borjie/database` because its name collides with a namespace
// that drizzle-orm/postgres-js's declaration merging pulls in at this
// consumption site. Deriving the type via ReturnType sidesteps that.
type DrizzleClient = ReturnType<typeof createDatabaseClient>;

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
    cachedClient = createDatabaseClient(url);
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

/** Test-only: reset the memo so unit tests can swap env. */
export function __resetDbClientForTests(): void {
  cachedClient = null;
  initialized = false;
  cachedReadonlyClient = null;
  readonlyInitialized = false;
}
