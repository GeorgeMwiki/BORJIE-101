/**
 * Database middleware for Hono.
 *
 * Initializes the database client and injects repositories into request
 * context. The historical `@ts-nocheck` pragma here gated two upstream
 * drifts (TS2709 namespace-vs-type for repos, Hono v4 status-code union
 * widening) that were resolved by Wave-14 augmentation and the
 * package-barrel cleanup. The TS2709 drift re-emerges whenever a sibling
 * package re-declares one of these symbols as an `interface` (eg.
 * `services/domain-services/src/common/repository.ts` exports
 * `interface TenantRepository`/`interface UserRepository`), so we now
 * derive every type via `InstanceType<typeof X>` / factory return types
 * instead of `import type` — the value imports remain canonical.
 */

import { createMiddleware } from 'hono/factory';
import {
  createDatabaseClient,
  withReservedConnection,
  TenantRepository,
  UserRepository,
  selectEncryptionPort,
  createFieldEncryptionAuditService,
} from '@borjie/database';
import pino from 'pino';

/**
 * DatabaseClient type — derived from the factory so we avoid the
 * package-barrel `TS2709 Cannot use namespace ... as a type` drift
 * that also affects service-registry.ts. The repository classes
 * stay imported from the main barrel because their branded TenantId
 * parameter types resolve correctly through the main index but not
 * through the `/repositories` subpath.
 */
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

/**
 * EncryptionPort + FieldEncryptionAuditSink types — derived from the
 * factory return types. Importing `type EncryptionPort` from
 * `@borjie/database` would resolve to a namespace under the same TS2709
 * drift because `services/domain-services` re-declares overlapping
 * symbols; deriving via `Awaited<ReturnType<typeof selectEncryptionPort>>`
 * sidesteps the barrel widening. `FieldEncryptionAuditService` is a
 * superset of `FieldEncryptionAuditSink` (the broader factory return
 * satisfies the narrower port slot), so the repos still receive the
 * exact shape they expect.
 */
type EncryptionPort = Awaited<ReturnType<typeof selectEncryptionPort>>;
type FieldEncryptionAuditSink = ReturnType<
  typeof createFieldEncryptionAuditService
>;

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Environment configuration
const DATABASE_URL = process.env.DATABASE_URL;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const EXPLICIT_MOCK_MODE = process.env.USE_MOCK_DATA === 'true';

if (IS_PRODUCTION && EXPLICIT_MOCK_MODE) {
  throw new Error('USE_MOCK_DATA is not allowed in production');
}

if (IS_PRODUCTION && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required in production');
}

const USE_MOCK_DATA = EXPLICIT_MOCK_MODE || !DATABASE_URL;

// Singleton database client (connection pooling handled by postgres.js)
let db: DatabaseClient | null = null;
// Phase D / A2b-1 — field-level encryption port + audit sink. Built
// lazily once per process from `process.env` and threaded into every
// repository so PII columns are encrypted on write and decrypted on
// read transparently. Set to `null` in dev/test when
// `ENCRYPTION_MASTER_KEY` is not configured — repos degrade to
// legacy plaintext mode in that case.
let encPort: EncryptionPort | null = null;
let encAudit: FieldEncryptionAuditSink | null = null;
let encryptionInitAttempted = false;

/**
 * Initialize database connection
 * Uses lazy initialization for better cold-start performance
 */
function getDatabase(): DatabaseClient | null {
  if (USE_MOCK_DATA) {
    return null;
  }

  if (!db && DATABASE_URL) {
    try {
      db = createDatabaseClient(DATABASE_URL);
      logger.info('Database client initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize database client');
      throw error;
    }
  }

  return db;
}

/**
 * Repository container - holds all repository instances.
 * Property-domain repos (PropertyRepository, UnitRepository, etc.) were
 * deleted in the Borjie hard-fork. Applications now use raw Drizzle queries
 * or route-specific service layers.
 *
 * The class symbols are imported as values; their instance types are
 * derived locally so the TS2709 namespace-collision drift (see header
 * note) doesn't fire at the type-use sites below.
 */
type TenantRepositoryInstance = InstanceType<typeof TenantRepository>;
type UserRepositoryInstance = InstanceType<typeof UserRepository>;

export interface Repositories {
  tenants: TenantRepositoryInstance;
  users: UserRepositoryInstance;
}

// Singleton repositories instance
let repositories: Repositories | null = null;

/**
 * Build the field-level encryption port + audit sink. Lazy so a missing
 * `ENCRYPTION_MASTER_KEY` in dev does not crash the boot — the repos
 * degrade to plaintext mode and surface a single startup warning. In
 * production the absence MUST be a hard failure; gateway boot wiring
 * checks that explicitly via `selectEncryptionPort`'s
 * `EncryptionKeyUnavailableError`.
 *
 * See gh-issue #42 — per-tenant KMS region routing:
 * ─────────────────────────────────────────────────────────────────────
 * This middleware constructs the encryption port as a MODULE-LOAD
 * SINGLETON (`encPort`, lines 84-86) — every repository instance in
 * the process shares the same port, bound to `env.AWS_REGION`. That
 * means tenants in a non-default region (ZA / af-south-1, NG /
 * af-west-1, etc.) are encrypted under the platform-default region's
 * CMK, NOT their own data-residency region's CMK.
 *
 * The plumbing is ready — `selectEncryptionPortForTenant` +
 * `getTenantRegion(db, tenantId)` (both exported from `@borjie/
 * database`) compose a per-request region-bound port. Wiring it here
 * requires lifting the encryption port from process-singleton scope
 * to request scope: every repository would need to be constructed
 * per-request (or accept the port as a per-call argument). Both paths
 * touch >15 repo classes + every route that resolves repositories
 * from `c.get('repos')`.
 *
 * Until that lift lands, callers that need region-bound KMS at request
 * time MUST construct their own port via:
 *
 *     import {
 *       selectEncryptionPortForTenant,
 *       getTenantRegion,
 *     } from '@borjie/database';
 *
 *     const port = await selectEncryptionPortForTenant(process.env, {
 *       tenantId: auth.tenantId,
 *       regionResolver: (id) => getTenantRegion(db, id),
 *       logger,
 *     });
 *
 * and pass it explicitly into the call site rather than relying on the
 * repository's default port. The OCR factory uses the same pattern
 * (see `services/document-intelligence/src/providers/ocr-factory.ts`).
 * ─────────────────────────────────────────────────────────────────────
 */
async function buildEncryption(
  database: DatabaseClient,
): Promise<{ port: EncryptionPort | null; audit: FieldEncryptionAuditSink | null }> {
  if (encryptionInitAttempted) {
    return { port: encPort, audit: encAudit };
  }
  encryptionInitAttempted = true;
  if (!process.env.ENCRYPTION_MASTER_KEY) {
    if (IS_PRODUCTION) {
      throw new Error(
        'ENCRYPTION_MASTER_KEY is required in production — refusing to start without field-level encryption',
      );
    }
    logger.warn(
      'ENCRYPTION_MASTER_KEY not configured; field-level encryption disabled (DEV mode only)',
    );
    return { port: null, audit: null };
  }
  try {
    encPort = await selectEncryptionPort(
      process.env as unknown as Record<string, string | undefined>,
    );
    encAudit = createFieldEncryptionAuditService(database);
    logger.info('Field-level encryption port + audit sink initialized');
    return { port: encPort, audit: encAudit };
  } catch (error) {
    logger.error({ error }, 'Failed to initialize encryption port');
    if (IS_PRODUCTION) throw error;
    return { port: null, audit: null };
  }
}

/**
 * Get or create repositories. The first call builds the encryption
 * port + audit sink (lazily). Subsequent calls reuse the singleton.
 */
function getRepositories(): Repositories | null {
  const database = getDatabase();
  if (!database) {
    return null;
  }

  if (!repositories) {
    // Kick off the encryption init in the background; until it resolves
    // repos run in plaintext mode. Production boot should call
    // `initRepositoriesAsync()` first to guarantee encryption is ready
    // before any request is served.
    void buildEncryption(database).then((res) => {
      encPort = res.port;
      encAudit = res.audit;
    });
    const deps = { encPort, encAudit };
    repositories = {
      tenants: new TenantRepository(database, deps),
      users: new UserRepository(database, deps),
    };
    logger.info('Repositories initialized');
  }

  return repositories;
}

/**
 * Async boot-time entry point that guarantees the encryption port is
 * fully constructed (KMS-adapter lazy-loaded) before any request is
 * served. Call this from the gateway boot sequence; the sync
 * `getRepositories()` path remains for tests that don't need
 * encryption.
 */
export async function initRepositoriesAsync(): Promise<Repositories | null> {
  const database = getDatabase();
  if (!database) return null;
  const { port, audit } = await buildEncryption(database);
  const deps = { encPort: port, encAudit: audit };
  repositories = {
    tenants: new TenantRepository(database, deps),
    users: new UserRepository(database, deps),
  };
  return repositories;
}

// Extend Hono context types
declare module 'hono' {
  interface ContextVariableMap {
    db: DatabaseClient | null;
    repos: Repositories | null;
    useMockData: boolean;
  }
}

import { sql } from 'drizzle-orm';

/**
 * Rebuild the repository container on a specific Drizzle client. Used to
 * re-bind `TenantRepository` / `UserRepository` onto the per-request
 * RESERVED connection so their queries run on the same backend connection
 * that carries the tenant GUC. Reuses the process-singleton encryption
 * port + audit sink (those are stateless ports, independent of the client).
 */
function rebuildRepositoriesOn(database: DatabaseClient): Repositories {
  const deps = { encPort, encAudit };
  return {
    tenants: new TenantRepository(database, deps),
    users: new UserRepository(database, deps),
  };
}

/**
 * True when `db` is a real pooled postgres.js-backed Drizzle client that
 * exposes `.reserve()` — i.e. we can pin a request to one connection.
 * A mock/in-memory client pre-injected by a unit test has no `$client`, so
 * we fall back to the legacy direct-bind path for it.
 */
function hasReservableClient(db: unknown): boolean {
  const client = (db as { $client?: { reserve?: unknown } } | null | undefined)
    ?.$client;
  return typeof client?.reserve === 'function';
}

/** Internal sentinel so a GUC-bind failure becomes a 500, while a genuine
 *  downstream handler error still propagates to Hono's error handler. */
class RlsBindError extends Error {}

const RLS_BIND_SQL = (tenantId: string) =>
  sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;

/**
 * Database middleware — request-scoped RLS connection pinning.
 *
 * Injects the database client + repositories into the request context and
 * binds the canonical `app.current_tenant_id` GUC so the FORCE-RLS policy on
 * every tenant-scoped table fires.
 *
 * THE PINNING INVARIANT (security-critical):
 * postgres.js checks out a connection PER STATEMENT. Binding the GUC with
 * `set_config(..., false)` on the shared pool and then reading as a separate
 * statement can land the read on a DIFFERENT connection whose GUC was last
 * set by another tenant's request — leaking rows across tenants under
 * concurrent load. So when a tenant is present we RESERVE one connection for
 * the whole request (`withReservedConnection`), bind the GUC on it, expose a
 * Drizzle client bound to that exact connection as `c.get('db')`, rebuild the
 * repos on it, and release (with a GUC reset) when the request ends. Every
 * statement the request issues therefore runs on the one connection that
 * carries its tenant GUC. This is NOT a request-wide transaction — per-
 * statement write atomicity is preserved exactly as before; only the
 * connection is held.
 *
 * GUC name: ONLY the canonical `app.current_tenant_id` is set (migration
 * 0172 unified `public.current_app_tenant_id()` to read it, with a legacy
 * `app.tenant_id` COALESCE fallback for out-of-band tooling). Do NOT add a
 * second set_config for the legacy name here.
 *
 * Streaming / long-external-call routers (LLM streams, calendar OAuth, MCP)
 * must NOT use this middleware — holding a reserved connection across a
 * multi-second external round-trip would exhaust the pool. They use
 * `databaseMiddlewareNoPin` and bind tenant context per DB operation via
 * `withTenantContext(...)`, keeping the external call outside any txn.
 */
export const databaseMiddleware = createMiddleware(async (c, next) => {
  // Unit tests can pre-populate `db` / `repos` on the context to exercise
  // routers without a live Postgres. We honour an existing binding; in
  // production the context is empty here so the real client is created.
  const preInjectedDb = c.get('db');
  const database = preInjectedDb ?? getDatabase();
  const baseRepos = c.get('repos') ?? getRepositories();
  const useMockData = !preInjectedDb && (USE_MOCK_DATA || !database);

  c.set('useMockData', useMockData);

  if (useMockData && process.env.NODE_ENV !== 'test') {
    c.set('db', database);
    c.set('repos', baseRepos);
    return c.json(
      {
        success: false,
        error: {
          code: 'LIVE_DATA_NOT_CONFIGURED',
          message: 'A live database connection is required for this endpoint.',
        },
      },
      503
    );
  }

  const auth = c.get('auth') as { tenantId?: string } | undefined;
  const tenantId = auth?.tenantId;

  // ── Pinned path: real pooled client + a tenant to bind ───────────────
  if (database && !useMockData && tenantId && hasReservableClient(database)) {
    try {
      await withReservedConnection(database as DatabaseClient, async (reqDb) => {
        try {
          await reqDb.execute(RLS_BIND_SQL(tenantId));
        } catch (error) {
          throw new RlsBindError(
            error instanceof Error ? error.message : String(error),
          );
        }
        // Expose the reserved-connection client + repos for the request.
        c.set('db', reqDb);
        c.set('repos', rebuildRepositoriesOn(reqDb));
        await next();
      });
    } catch (err) {
      if (err instanceof RlsBindError) {
        logger.error(
          { error: err.message, tenantId },
          'Failed to set RLS tenant context on reserved connection',
        );
        return c.json(
          {
            success: false,
            error: {
              code: 'RLS_CONTEXT_FAILED',
              message: 'Could not establish tenant security context.',
            },
          },
          500
        );
      }
      // A genuine downstream handler error — re-throw to Hono's onError.
      throw err;
    }
    return;
  }

  // ── Fallback path: no tenant, or a mock client with no `.reserve()` ──
  // Mirrors the historical direct-bind behaviour. A mock client used in
  // unit tests has no pool, so there is no cross-connection window to
  // close; a no-tenant request (e.g. the public calendar callback) binds
  // its own tenant context per operation.
  c.set('db', database);
  c.set('repos', baseRepos);
  if (database && !useMockData && tenantId) {
    try {
      await database.execute(RLS_BIND_SQL(tenantId));
    } catch (error) {
      logger.error({ error, tenantId }, 'Failed to set RLS tenant context');
      return c.json(
        {
          success: false,
          error: {
            code: 'RLS_CONTEXT_FAILED',
            message: 'Could not establish tenant security context.',
          },
        },
        500
      );
    }
  }
  await next();
});

/**
 * Database middleware — NO connection pinning.
 *
 * Injects the database client + repositories (and the mock-data gate) but
 * does NOT reserve a connection and does NOT bind the tenant GUC. For
 * streaming / long-external-call routers (LLM token streams, calendar
 * OAuth, MCP) that would otherwise hold a reserved pool connection across a
 * multi-second external round-trip.
 *
 * CONTRACT for routers using this: bind tenant context PER DB OPERATION via
 * `withTenantContext(db, tenantId, fn)` (a short SET LOCAL transaction), and
 * keep every external call (LLM / payment / calendar API) OUTSIDE any such
 * transaction. Routers that maintain their own dedicated client + per-op
 * `set_config(..., true)` (e.g. brain-teach, brain-voice) get the mock gate
 * + service context from this without an unused reserved connection.
 */
export const databaseMiddlewareNoPin = createMiddleware(async (c, next) => {
  const preInjectedDb = c.get('db');
  const database = preInjectedDb ?? getDatabase();
  const repos = c.get('repos') ?? getRepositories();
  const useMockData = !preInjectedDb && (USE_MOCK_DATA || !database);

  c.set('db', database);
  c.set('repos', repos);
  c.set('useMockData', useMockData);

  if (useMockData && process.env.NODE_ENV !== 'test') {
    return c.json(
      {
        success: false,
        error: {
          code: 'LIVE_DATA_NOT_CONFIGURED',
          message: 'A live database connection is required for this endpoint.',
        },
      },
      503
    );
  }

  await next();
});

/**
 * Check whether test-only in-memory mode is active
 */
export function isUsingMockData(): boolean {
  return USE_MOCK_DATA || !getDatabase();
}

/**
 * Get database client (for direct queries if needed)
 */
export function getDatabaseClient(): DatabaseClient | null {
  return getDatabase();
}

/**
 * Helper to generate UUIDs for new records
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Helper to build pagination response
 */
export function buildPaginationResponse(
  page: number,
  pageSize: number,
  totalItems: number
) {
  const totalPages = Math.ceil(totalItems / pageSize);
  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}
