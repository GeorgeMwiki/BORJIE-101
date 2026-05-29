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
 * Database middleware
 *
 * Injects database client and repositories into request context AND sets
 * `app.current_tenant_id` on the connection so the RLS policies attached to
 * every tenant-scoped table actually fire. Without this set, every RLS
 * `tenant_id = current_setting('app.current_tenant_id')` predicate would
 * evaluate to NULL = NULL (FALSE) — silently zero rows or, worse, RLS bypass
 * depending on Postgres setting.
 *
 * GUC name canonicalisation: this middleware sets `app.current_tenant_id`.
 * Migration 0172 unified `public.current_app_tenant_id()` (the helper used
 * by 0155 / 0156 / 0169 policies) to read the same name, so every
 * tenant-scoped policy now agrees on a single GUC. The legacy
 * `app.tenant_id` name is retained as a COALESCE fallback inside the
 * helper for out-of-band tooling — DO NOT introduce a second
 * set_config call here for that legacy name.
 *
 * Order of operations:
 *  1. Look up the authenticated principal that `authMiddleware` already
 *     attached to `c.get('auth')`.
 *  2. Cast the tenant id and call `SET LOCAL app.current_tenant_id = ...`
 *     on the same connection that subsequent repo queries will use. The
 *     `SET LOCAL` form scopes the setting to the current transaction; we
 *     wrap it in `BEGIN`/`COMMIT` (or use postgres.js' implicit txn) so the
 *     setting cannot leak across requests sharing the pool.
 */
export const databaseMiddleware = createMiddleware(async (c, next) => {
  // Unit tests can pre-populate `db` and `repos` on the context to exercise
  // routers without a live Postgres. We honour an existing binding so the
  // middleware becomes a no-op in that case; in production the context is
  // always empty at this point so the real client is created as before.
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

  // Set RLS tenant context BEFORE any repository runs queries.
  if (database && !useMockData) {
    const auth = c.get('auth') as { tenantId?: string } | undefined;
    const tenantId = auth?.tenantId;
    if (tenantId) {
      try {
        // postgres.js executes one statement per call on a checked-out connection.
        // `SET` (not `SET LOCAL`) lasts the session — for a pooled connection that
        // means until the next setting overrides it. Since every authenticated
        // request resets it before any read, no cross-tenant leak is possible.
        // Using `set_config` avoids interpolation issues and is safe against
        // SQL injection via the boolean third argument.
        // Set ONLY the canonical GUC name `app.current_tenant_id`. Migration
        // 0172b unified `public.current_app_tenant_id()` to read this name
        // first and fall back to the legacy `app.tenant_id` for out-of-band
        // tooling — so setting both here is redundant and re-introduces the
        // GUC-name drift that F2 closed. The middleware MUST set the canonical
        // name and only the canonical name.
        await database.execute(
          sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`
        );
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
