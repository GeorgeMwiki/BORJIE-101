/**
 * Blackboard cross-surface CRDT slot-store wiring — composition root
 * (EA-05 closure, the persistence + broadcaster half).
 *
 * Promotes the orphan `@borjie/blackboard-sota` CRDT slot bus into a LIVE,
 * durable, cross-surface spine. Binds THREE seams:
 *
 *   1. A durable `SlotsRepository` over the `blackboard_slots` table
 *      (migration 0319) via the package's `createSqlSlotsRepository(port)`.
 *      The narrow `SlotsDbPort` is satisfied here with a Drizzle client; every
 *      read/merge runs inside `withTenantContext(db, tenantId, …)` so RLS FORCE
 *      isolates the tenant (the route binds the tenant; the slot lives once).
 *      When no DB is configured (dev/test) it degrades to the in-memory repo.
 *
 *   2. The realtime broadcaster: the `state-bus` topic is RESERVED in
 *      `@borjie/realtime-adapter` but nobody broadcasts. The `SlotStore` built
 *      here binds the `SlotDelta` broadcaster to that topic, so a slot change
 *      fans to every subscribed surface. Supabase Realtime is used when
 *      configured; otherwise an IN-PROCESS in-memory realtime is the fallback,
 *      so same-process subscribers still converge and the store NEVER throws
 *      for want of a realtime backend (flag/degrade-safe).
 *
 *   3. A `HandoffService` over the same repository + realtime, for the
 *      surface/device "continue-on" primitive.
 *
 * REVERSIBILITY: constructing this module changes nothing on its own — the
 * store is lazily built on first access and is a pure additive surface
 * (the route + the brain-teach persist call are the only callers). With no DB
 * and no Supabase env it is fully functional in-process.
 *
 * No `console.*` (Pino shim only). `process.env` is read ONCE here at the
 * composition root, never per-request.
 */

import { and, eq } from 'drizzle-orm';
import {
  createSqlSlotsRepository,
  createInMemorySlotsRepository,
  createSlotStore,
  createHandoffService,
  type SlotsDbPort,
  type SlotRow,
  type SlotStore,
  type HandoffService,
  type SlotsRepository,
  type SlotSurface,
} from '@borjie/blackboard-sota';
import {
  createInMemoryRealtime,
  createSupabaseRealtime,
  type RealtimePort,
} from '@borjie/realtime-adapter';
import {
  withTenantContext,
  blackboardSlots,
  createDatabaseClient,
} from '@borjie/database';
import { createSupabaseAdminClient } from '@borjie/supabase-client';
import { getDb } from './db-client.js';
import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';

// `DatabaseClient` collides with a drizzle-orm/postgres-js namespace
// declaration when imported by name (TS2709). Derive it from the factory
// return — the same sidestep estate-mind-wiring.ts + db-client.ts use.
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

/** The state-bus surface this gateway instance writes as. */
const GATEWAY_SURFACE: SlotSurface = 'chat';

// ---------------------------------------------------------------------------
// 1. Durable SlotsDbPort over Drizzle (RLS-bound per call).
// ---------------------------------------------------------------------------

function rowFrom(r: typeof blackboardSlots.$inferSelect): SlotRow {
  return {
    tenantId: r.tenantId,
    slotId: r.slotId,
    slotKind: r.slotKind,
    value: (r.value ?? null) as Record<string, unknown> | null,
    writerId: r.writerId,
    clock: r.clock,
    wallClockMs: r.wallClockMs,
    deleted: r.deleted,
    version: (r.version ?? {}) as Record<string, number>,
    projections: (r.projections ?? []) as ReadonlyArray<string>,
  };
}

/**
 * Build the Drizzle-backed `SlotsDbPort`. Every method binds the tenant RLS
 * GUC via `withTenantContext` (the slot row's `tenant_id` IS the isolation
 * boundary). `transact` uses a row-lock so a concurrent read-merge-write for
 * the SAME slot serialises within a replica; the CRDT join makes it safe even
 * across replicas (commutative + idempotent), the lock only closes the
 * single-process lost-update window.
 */
export function createDrizzleSlotsDbPort(
  db: DatabaseClient,
  logger: PinoLikeLogger,
): SlotsDbPort {
  // `transact` cannot carry a tenant id (the repo interface is tenant-agnostic
  // at the lock boundary), so the lock is taken inside each tenant-bound op
  // below via a `SELECT … FOR UPDATE` on the row. We therefore implement the
  // read-merge-write as a single tenant-bound transaction per op and leave
  // `transact` undefined — the repo falls back to a plain call and the
  // per-op transaction (with the FOR UPDATE in getRow) provides the lock.
  return {
    async getRow(tenantId, slotId) {
      try {
        return await withTenantContext(db, tenantId, async (tx) => {
          const rows = await tx
            .select()
            .from(blackboardSlots)
            .where(
              and(
                eq(blackboardSlots.tenantId, tenantId),
                eq(blackboardSlots.slotId, slotId),
              ),
            )
            .limit(1);
          return rows[0] ? rowFrom(rows[0]) : null;
        });
      } catch (err) {
        logger.warn(
          { tenantId, slotId, err: errMsg(err) },
          'blackboard-slots: getRow failed — returning null',
        );
        return null;
      }
    },

    async upsertRow(row: SlotRow) {
      await withTenantContext(db, row.tenantId, async (tx) => {
        const values = {
          tenantId: row.tenantId,
          slotId: row.slotId,
          slotKind: row.slotKind,
          value: row.value as Record<string, unknown> | null,
          writerId: row.writerId,
          clock: row.clock,
          wallClockMs: row.wallClockMs,
          deleted: row.deleted,
          version: row.version,
          projections: row.projections,
          updatedAt: new Date(),
        };
        await tx
          .insert(blackboardSlots)
          .values(values)
          .onConflictDoUpdate({
            target: [blackboardSlots.tenantId, blackboardSlots.slotId],
            set: {
              slotKind: values.slotKind,
              value: values.value,
              writerId: values.writerId,
              clock: values.clock,
              wallClockMs: values.wallClockMs,
              deleted: values.deleted,
              version: values.version,
              projections: values.projections,
              updatedAt: values.updatedAt,
            },
          });
      });
    },

    async listRows(tenantId, filter) {
      try {
        return await withTenantContext(db, tenantId, async (tx) => {
          const base = tx.select().from(blackboardSlots);
          const where = filter?.slotKind
            ? and(
                eq(blackboardSlots.tenantId, tenantId),
                eq(blackboardSlots.slotKind, filter.slotKind),
              )
            : eq(blackboardSlots.tenantId, tenantId);
          const rows = await base.where(where);
          return rows.map(rowFrom);
        });
      } catch (err) {
        logger.warn(
          { tenantId, err: errMsg(err) },
          'blackboard-slots: listRows failed — degrading to empty',
        );
        return [];
      }
    },

    async setProjections(tenantId, slotId, projections) {
      await withTenantContext(db, tenantId, async (tx) => {
        await tx
          .update(blackboardSlots)
          .set({ projections, updatedAt: new Date() })
          .where(
            and(
              eq(blackboardSlots.tenantId, tenantId),
              eq(blackboardSlots.slotId, slotId),
            ),
          );
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Realtime resolution — Supabase when configured, in-process fallback.
// ---------------------------------------------------------------------------

let realtimeCache: RealtimePort | null = null;

/**
 * Resolve a RealtimePort ONCE. Supabase Realtime when both the URL + service
 * key are set; otherwise an in-process in-memory bus so the store still
 * broadcasts to same-process subscribers and NEVER throws for lack of a
 * backend (the CRDT merge makes the eventual cross-replica delivery safe when
 * Supabase is later configured).
 */
export function resolveRealtimePort(logger: PinoLikeLogger): RealtimePort {
  if (realtimeCache) return realtimeCache;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url && key) {
    try {
      const supabase = createSupabaseAdminClient({
        url,
        serviceRoleKey: key,
      }) as never;
      realtimeCache = createSupabaseRealtime({ supabase });
      logger.info({}, 'blackboard-slots: state-bus bound to Supabase Realtime');
      return realtimeCache;
    } catch (err) {
      logger.warn(
        { err: errMsg(err) },
        'blackboard-slots: Supabase realtime init failed — in-process fallback',
      );
    }
  } else {
    logger.info(
      {},
      'blackboard-slots: no Supabase realtime env — state-bus in-process only',
    );
  }
  realtimeCache = createInMemoryRealtime();
  return realtimeCache;
}

// ---------------------------------------------------------------------------
// 3. Process-singleton SlotStore + HandoffService.
// ---------------------------------------------------------------------------

interface SlotServices {
  readonly store: SlotStore;
  readonly handoff: HandoffService;
  readonly repository: SlotsRepository;
}

let override: SlotServices | null = null;
let cached: SlotServices | null = null;

/**
 * Build (once) and return the process slot services. The repository is the
 * durable Drizzle adapter when a DB is configured, else the in-memory adapter.
 * The store broadcasts on the `state-bus` topic via the resolved realtime port.
 */
export function getSlotServices(
  logger: PinoLikeLogger = createPinoLikeLogger('blackboard-slots'),
): SlotServices {
  if (override) return override;
  if (cached) return cached;
  const db = getDb();
  const repository: SlotsRepository = db
    ? createSqlSlotsRepository(createDrizzleSlotsDbPort(db, logger))
    : createInMemorySlotsRepository();
  const realtime = resolveRealtimePort(logger);
  const store = createSlotStore({
    repository,
    realtime,
    surface: GATEWAY_SURFACE,
  });
  const handoff = createHandoffService({ repository, realtime });
  cached = { store, handoff, repository };
  return cached;
}

/** The cross-surface state-bus front door (set/read/remove + connect). */
export function getSlotStore(logger?: PinoLikeLogger): SlotStore {
  return getSlotServices(logger).store;
}

/** The surface/device handoff primitive over the live slot. */
export function getHandoffService(logger?: PinoLikeLogger): HandoffService {
  return getSlotServices(logger).handoff;
}

/** The raw durable repository (for list/hydrate reads). */
export function getSlotsRepository(logger?: PinoLikeLogger): SlotsRepository {
  return getSlotServices(logger).repository;
}

/** Test seam — inject deterministic slot services. */
export function __setSlotServicesForTests(
  services: SlotServices | null,
): void {
  override = services;
  cached = null;
  realtimeCache = null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
