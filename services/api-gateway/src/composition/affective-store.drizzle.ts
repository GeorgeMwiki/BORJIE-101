/**
 * Drizzle-backed `AffectiveStore` adapter — the durable, multi-replica-safe
 * backing store for the kernel's theory-of-mind affective accumulator
 * (packages/central-intelligence/src/kernel/theory-of-mind.ts).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Migration 0372 created `affective_profiles`, and theory-of-mind.ts exposes a
 * pluggable `AffectiveStore` interface + in-memory fallback — but no concrete DB
 * adapter was ever wired, so the durable store the migration claims did not
 * exist. This file is that adapter. `createDrizzleAffectiveStore(db)` maps the
 * accumulator's `AffectiveStoreRecord` snapshot to / from the long-format
 * five-dimension rows and injects at composition so `observe()` write-throughs
 * persist and a restart / replica `hydrate()`s from the DB.
 *
 * SHAPE
 *   The accumulator holds one `AffectiveState` (5 [0,1] dimensions) per
 *   (tenant, user). The table is long-format: one row per
 *   (tenant_id, user_id, dimension). `save()` upserts all five rows in a single
 *   statement (ON CONFLICT on the composite PK); `load()` reads them back and
 *   folds them into a single record, honouring the TTL via `expires_at`.
 *
 * TENANT ISOLATION
 *   Every call runs inside `withTenantContext(db, tenantId, …, { serviceRole:
 *   true })`. The tenant GUC scopes the request-path `tenant_isolation` policy
 *   to this tenant, and the service-role flag lets the shared api-gateway pool
 *   upsert / hydrate cross-tenant when RLS enforcement is on (0342/0354 pattern).
 *   A `load()` for tenant A can never observe tenant B's rows.
 *
 * FAIL-SAFE
 *   The accumulator already swallows any rejection from `load` / `save` and
 *   degrades to in-memory (theory-of-mind.ts writeThrough/hydrate). This adapter
 *   therefore lets DB errors PROPAGATE as a rejected promise — that is the
 *   signal the accumulator degrades on. It never throws synchronously and never
 *   returns a partially-applied write.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  affectiveProfiles,
  AFFECTIVE_DIMENSIONS,
  withTenantContext,
} from '@borjie/database';
import type {
  AffectiveState,
  AffectiveStore,
  AffectiveStoreRecord,
} from '@borjie/central-intelligence';

/**
 * The five affective dimensions, typed locally off the schema constant. We do
 * NOT import `AffectiveDimension` from `@borjie/database` — the barrel re-exports
 * a value/namespace of the same name at this consumption site, which trips
 * `TS2709 Cannot use namespace as a type` (the same collision the cost-ledger /
 * db-client seams sidestep). Deriving it from the value keeps the file typed.
 */
type AffectiveDimension = (typeof AFFECTIVE_DIMENSIONS)[number];

/**
 * Drizzle client shape — kept `any` at the constructor seam on purpose. The
 * drizzle fluent builders have deeply-nested generics the composition root
 * cannot reproduce, and widening through the `@borjie/database` barrel trips
 * `TS2709 Cannot use namespace 'DatabaseClient' as a type`. Every row is cast to
 * a narrow record before it is touched, so the rest of the file stays typed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleLike = any;

/** Long-format row → typed dimension value pair. */
interface DimensionRow {
  readonly dimension: string;
  readonly value: unknown;
  readonly turns: unknown;
  readonly updatedAt: unknown;
  readonly expiresAt: unknown;
}

const DIMENSION_SET: ReadonlySet<string> = new Set(AFFECTIVE_DIMENSIONS);

function toMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const parsed = Date.parse(v);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Build the DB-backed store. Guard the call site with `db ?
 * createDrizzleAffectiveStore(db) : undefined` — a null `db` means no durable
 * store, and the accumulator stays pure in-memory (its documented degrade).
 */
export function createDrizzleAffectiveStore(db: DrizzleLike): AffectiveStore {
  if (!db) {
    throw new Error('createDrizzleAffectiveStore requires a Drizzle client');
  }

  return {
    async load(
      tenantId: string,
      userId: string,
    ): Promise<AffectiveStoreRecord | null> {
      const rows = (await withTenantContext(
        db,
        tenantId,
        async (tx: DrizzleLike) =>
          tx
            .select({
              dimension: affectiveProfiles.dimension,
              value: affectiveProfiles.value,
              turns: affectiveProfiles.turns,
              updatedAt: affectiveProfiles.updatedAt,
              expiresAt: affectiveProfiles.expiresAt,
            })
            .from(affectiveProfiles)
            .where(
              and(
                eq(affectiveProfiles.tenantId, tenantId),
                eq(affectiveProfiles.userId, userId),
                inArray(affectiveProfiles.dimension, [...AFFECTIVE_DIMENSIONS]),
              ),
            ),
        { serviceRole: true },
      )) as DimensionRow[];

      if (!rows || rows.length === 0) return null;

      const state: Record<AffectiveDimension, number> = {} as Record<
        AffectiveDimension,
        number
      >;
      let turns = 0;
      let updatedAtMs = 0;
      let expiresAtMs = 0;

      for (const r of rows) {
        if (!DIMENSION_SET.has(r.dimension)) continue;
        state[r.dimension as AffectiveDimension] = clamp01(Number(r.value));
        const t = Number(r.turns) || 0;
        if (t > turns) turns = t;
        updatedAtMs = Math.max(updatedAtMs, toMs(r.updatedAt));
        // The whole profile shares one expiry; take the newest write's value.
        const rowExpiry = toMs(r.expiresAt);
        if (rowExpiry > expiresAtMs) expiresAtMs = rowExpiry;
      }

      // A partial row set (missing a dimension) is treated as absent so the
      // accumulator never hydrates an incomplete posterior.
      for (const dim of AFFECTIVE_DIMENSIONS) {
        if (!(dim in state)) return null;
      }

      return {
        state: state as unknown as AffectiveState,
        turns,
        updatedAtMs,
        expiresAtMs,
      };
    },

    async save(
      tenantId: string,
      userId: string,
      record: AffectiveStoreRecord,
    ): Promise<void> {
      const updatedAt = new Date(record.updatedAtMs);
      const expiresAt = new Date(record.expiresAtMs);
      const values = AFFECTIVE_DIMENSIONS.map((dimension) => ({
        tenantId,
        userId,
        dimension,
        // numeric(4,3) — clamp + fixed 3dp so the CHECK (0..1) never trips.
        value: clamp01(
          record.state[dimension as keyof AffectiveState],
        ).toFixed(3),
        turns: record.turns,
        expiresAt,
        updatedAt,
      }));

      await withTenantContext(
        db,
        tenantId,
        async (tx: DrizzleLike) =>
          tx
            .insert(affectiveProfiles)
            .values(values)
            .onConflictDoUpdate({
              target: [
                affectiveProfiles.tenantId,
                affectiveProfiles.userId,
                affectiveProfiles.dimension,
              ],
              set: {
                value: sql`excluded.value`,
                turns: sql`excluded.turns`,
                expiresAt: sql`excluded.expires_at`,
                updatedAt: sql`excluded.updated_at`,
              },
            }),
        { serviceRole: true },
      );
    },
  };
}
