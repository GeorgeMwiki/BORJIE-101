/**
 * Onboarding-session store (RSS-09).
 *
 * The move-in onboarding state machine (`@borjie/domain-services/onboarding`,
 * wired in `routes/onboarding.ts`) talks to an `OnboardingRepository` port.
 * Historically that port had ONE implementation: a process-level in-memory
 * `Map` triple — so every session was WIPED on gateway restart and INVISIBLE
 * across replicas (MASTER_GAP_REGISTER RSS-09).
 *
 * This module adds a second implementation, `createDrizzleOnboardingRepo`,
 * which persists the full `OnboardingSession` aggregate to the tenant-scoped
 * `onboarding_sessions` table (migration 0314). The three queryable lookup
 * keys (id / customer / lease) are columns; the rest of the aggregate is a
 * single `payload` jsonb document, rehydrated verbatim. RLS (FORCE, canonical
 * `app.current_tenant_id` GUC) enforces tenant isolation at the row level on
 * the request-scoped, tenant-bound DB handle.
 *
 * Both factories implement the IDENTICAL `OnboardingRepository` port, mirroring
 * the memory-v2 `store-inmemory` / `store-drizzle` pair (MEM-01). The router
 * selects between them via `resolveOnboardingRepo` (see below), which is gated
 * by the `ONBOARDING_SESSION_STORE` env flag and DEFAULTS to the in-memory repo
 * — so merging this code changes NOTHING at runtime until the flag is flipped.
 *
 * Design invariants
 *   - Immutability: every method returns a frozen / fresh value; nothing
 *     mutates a caller's object in place.
 *   - No console.*: errors surface via the injected Pino-like logger + thrown
 *     exceptions (the route layer catches + logs).
 *   - Tenant isolation: the Drizzle repo relies on the row-level RLS policy on
 *     the request-bound handle; the in-memory repo keys on `${tenantId}::${id}`.
 */

import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { onboardingSessions } from '@borjie/database';
import type { createDatabaseClient } from '@borjie/database';
import {
  type OnboardingRepository,
  type OnboardingSession,
  type OnboardingSessionId,
} from '@borjie/domain-services/onboarding';
import type {
  TenantId,
  CustomerId,
  LeaseId,
} from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Local type derivations.
//
// `DatabaseClient` and the schema row-type alias are derived locally via
// `ReturnType` / `$inferSelect` to dodge the `TS2709 namespace-vs-type` barrel
// drift that bites the named `@borjie/database` type-alias exports at this
// consumption site (same pattern as services/action-executor/types.ts and
// composition/db-client.ts).
// ---------------------------------------------------------------------------

type DatabaseClient = ReturnType<typeof createDatabaseClient>;
type OnboardingSessionStoreRow = typeof onboardingSessions.$inferSelect;

// ---------------------------------------------------------------------------
// Flag resolution (read once, at module load — never per-request).
// ---------------------------------------------------------------------------

/**
 * `ONBOARDING_SESSION_STORE` selects the durable backing for the move-in
 * onboarding repository.
 *
 *   - `memory`  (DEFAULT) — the legacy in-memory Map triple. Lost on restart,
 *                           not shared across replicas. Current behaviour.
 *   - `drizzle`           — the durable Postgres table (migration 0314), used
 *                           only when a live DB handle is also present.
 *
 * Read once here so the choice is a pure module constant (CLAUDE.md: no
 * `process.env` reads on the request path).
 */
const ONBOARDING_SESSION_STORE_MODE: 'memory' | 'drizzle' =
  process.env.ONBOARDING_SESSION_STORE === 'drizzle' ? 'drizzle' : 'memory';

export function onboardingSessionStoreMode(): 'memory' | 'drizzle' {
  return ONBOARDING_SESSION_STORE_MODE;
}

// ---------------------------------------------------------------------------
// Logger port (Pino-shaped; no console.* in services).
// ---------------------------------------------------------------------------

export interface OnboardingStoreLogger {
  error(obj: Record<string, unknown>, msg: string): void;
}

const NOOP_LOGGER: OnboardingStoreLogger = {
  error() {
    /* no-op default; the router injects the real Pino logger */
  },
};

// ---------------------------------------------------------------------------
// In-memory implementation (verbatim extraction of the old router logic).
// ---------------------------------------------------------------------------

/**
 * Process-wide in-memory repo. Tenant isolation is enforced by the composite
 * `${tenantId}::${id}` key. Behaviour is byte-for-byte identical to the
 * `createInMemoryRepo` that previously lived inline in `routes/onboarding.ts`.
 */
export function createInMemoryOnboardingRepo(): OnboardingRepository {
  const byId = new Map<string, OnboardingSession>();
  const byCustomer = new Map<string, OnboardingSession>();
  const byLease = new Map<string, OnboardingSession>();

  const key = (t: string, id: string): string => `${t}::${id}`;

  return {
    async findById(id, tenantId) {
      return byId.get(key(String(tenantId), String(id))) ?? null;
    },
    async findByCustomer(customerId, tenantId) {
      return byCustomer.get(key(String(tenantId), String(customerId))) ?? null;
    },
    async findByLease(leaseId, tenantId) {
      return byLease.get(key(String(tenantId), String(leaseId))) ?? null;
    },
    async create(session) {
      byId.set(key(String(session.tenantId), String(session.id)), session);
      byCustomer.set(
        key(String(session.tenantId), String(session.customerId)),
        session,
      );
      byLease.set(
        key(String(session.tenantId), String(session.leaseId)),
        session,
      );
      return session;
    },
    async update(session) {
      byId.set(key(String(session.tenantId), String(session.id)), session);
      byCustomer.set(
        key(String(session.tenantId), String(session.customerId)),
        session,
      );
      byLease.set(
        key(String(session.tenantId), String(session.leaseId)),
        session,
      );
      return session;
    },
  };
}

// ---------------------------------------------------------------------------
// Drizzle implementation.
// ---------------------------------------------------------------------------

/**
 * Minimal validation of the lookup-key shape before any write. The full
 * aggregate is opaque jsonb; we only guard the columns we index on.
 */
const sessionKeysSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  customerId: z.string().min(1),
  leaseId: z.string().min(1),
  state: z.string().min(1),
});

/**
 * Rehydrate the full `OnboardingSession` aggregate from a stored row. The
 * aggregate was serialised verbatim into `payload`, so we trust it and only
 * re-overlay the column values (the source of truth for the lookup keys).
 */
function rowToSession(row: OnboardingSessionStoreRow): OnboardingSession {
  const payload = (row.payload ?? {}) as OnboardingSession;
  return Object.freeze({
    ...payload,
    id: row.id as OnboardingSessionId,
    tenantId: row.tenantId as TenantId,
    customerId: row.customerId as CustomerId,
    leaseId: row.leaseId as LeaseId,
  }) as OnboardingSession;
}

function toRowValues(session: OnboardingSession) {
  const parsed = sessionKeysSchema.safeParse(session);
  if (!parsed.success) {
    throw new Error(
      `onboarding-session drizzle: invalid session keys (${JSON.stringify(
        parsed.error.issues,
      )})`,
    );
  }
  return {
    tenantId: String(session.tenantId),
    id: String(session.id),
    customerId: String(session.customerId),
    leaseId: String(session.leaseId),
    state: String(session.state),
    payload: session as unknown,
    updatedAt: new Date(),
  };
}

/**
 * Durable Drizzle-backed onboarding repository.
 *
 * The `db` handle is the request-scoped, RLS-bound client injected by
 * `databaseMiddleware`; the table's FORCE-RLS tenant-isolation policy guards
 * every row, so the `findBy*` queries still pass `tenantId` in the predicate
 * (defence-in-depth + uses the `(tenant_id, …)` indexes).
 */
export function createDrizzleOnboardingRepo(
  db: DatabaseClient,
  logger: OnboardingStoreLogger = NOOP_LOGGER,
): OnboardingRepository {
  async function upsert(session: OnboardingSession): Promise<OnboardingSession> {
    const values = toRowValues(session);
    try {
      await db
        .insert(onboardingSessions)
        .values(values)
        .onConflictDoUpdate({
          target: [onboardingSessions.tenantId, onboardingSessions.id],
          set: {
            customerId: values.customerId,
            leaseId: values.leaseId,
            state: values.state,
            payload: values.payload,
            updatedAt: values.updatedAt,
          },
        });
      return Object.freeze({ ...session }) as OnboardingSession;
    } catch (err) {
      logger.error(
        { err, tenantId: String(session.tenantId), id: String(session.id) },
        'onboarding-session drizzle upsert failed',
      );
      throw err;
    }
  }

  return {
    async findById(id, tenantId) {
      const rows = (await db
        .select()
        .from(onboardingSessions)
        .where(
          and(
            eq(onboardingSessions.tenantId, String(tenantId)),
            eq(onboardingSessions.id, String(id)),
          ),
        )
        .limit(1)) as OnboardingSessionStoreRow[];
      return rows.length > 0 ? rowToSession(rows[0]!) : null;
    },

    async findByCustomer(customerId, tenantId) {
      const rows = (await db
        .select()
        .from(onboardingSessions)
        .where(
          and(
            eq(onboardingSessions.tenantId, String(tenantId)),
            eq(onboardingSessions.customerId, String(customerId)),
          ),
        )
        .limit(1)) as OnboardingSessionStoreRow[];
      return rows.length > 0 ? rowToSession(rows[0]!) : null;
    },

    async findByLease(leaseId, tenantId) {
      const rows = (await db
        .select()
        .from(onboardingSessions)
        .where(
          and(
            eq(onboardingSessions.tenantId, String(tenantId)),
            eq(onboardingSessions.leaseId, String(leaseId)),
          ),
        )
        .limit(1)) as OnboardingSessionStoreRow[];
      return rows.length > 0 ? rowToSession(rows[0]!) : null;
    },

    create: upsert,
    update: upsert,
  };
}

// ---------------------------------------------------------------------------
// Resolver — the single decision point the router calls per request.
// ---------------------------------------------------------------------------

/**
 * Resolve the onboarding repository for a request.
 *
 * Returns the durable Drizzle repo ONLY when BOTH conditions hold:
 *   1. `ONBOARDING_SESSION_STORE=drizzle` (the flag is opt-in), AND
 *   2. a live, RLS-bound DB handle is present on the request context.
 *
 * Otherwise it returns the process-shared in-memory repo — which is the
 * DEFAULT, so behaviour is unchanged until the flag is set. The shared
 * in-memory instance is passed in by the caller so its lifetime matches the
 * router module (one process-wide map triple, exactly as before).
 */
export function resolveOnboardingRepo(args: {
  readonly db: DatabaseClient | null | undefined;
  readonly sharedInMemoryRepo: OnboardingRepository;
  readonly logger?: OnboardingStoreLogger;
}): OnboardingRepository {
  if (ONBOARDING_SESSION_STORE_MODE === 'drizzle' && args.db != null) {
    return createDrizzleOnboardingRepo(args.db, args.logger);
  }
  return args.sharedInMemoryRepo;
}
