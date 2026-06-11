/**
 * SQL `SlotsRepository` adapter — the DURABLE backing for the cross-surface
 * CRDT state bus (EA-05 closure).
 *
 * The in-memory adapter ships with the package for tests + dev; THIS adapter
 * persists slots to Postgres so a decision/doc/task survives a process restart
 * and is shared across replicas. It implements the EXACT same
 * {@link SlotsRepository} contract, so the {@link createSlotStore} front door,
 * the {@link createHandoffService}, the gateway route, and every test are
 * adapter-agnostic.
 *
 * THE LOAD-BEARING INVARIANT: `merge` is a CRDT lattice-join (read → mergeSlot
 * → upsert), never a blind overwrite. Two concurrent cross-surface writes —
 * even delivered out of order or duplicated by the at-least-once realtime
 * transport — converge to the same value on every replica. The upsert is
 * keyed by (tenant_id, slot_id) so a re-merge of the same delta is idempotent.
 *
 * DB-AGNOSTIC BY DESIGN: the package does not depend on `@borjie/database`
 * (that would couple the substrate to a specific Drizzle build + risk a
 * dependency cycle). Instead it consumes a narrow {@link SlotsDbPort} that the
 * gateway composition root satisfies with a Drizzle client + the
 * `blackboard_slots` table (migration 0319). The port speaks rows, not SQL, so
 * the CRDT merge stays here where it is unit-tested.
 *
 * CONCURRENCY NOTE: the read-merge-write is wrapped by the port's
 * `transact(slotId, fn)` so a row-level lock (SELECT … FOR UPDATE) serialises
 * concurrent merges of the SAME slot within one process/replica. The CRDT join
 * makes the merge safe even WITHOUT the lock (it is commutative + idempotent),
 * so a port that cannot lock (e.g. the in-memory test double) still converges —
 * the lock only removes a last-writer-wins lost-update window under contention.
 */

import {
  type Slot,
  type SlotKind,
  type SlotsRepository,
  type SlotSurface,
} from '../types.js';
import { mergeSlot } from '../slots/slot-crdt.js';

/**
 * A persisted slot row — the wire shape between the package's CRDT logic and
 * the gateway's Drizzle table. Mirrors `blackboard_slots` (migration 0319).
 * `version` and `projections` are plain JSON so the port stays Drizzle-free.
 */
export interface SlotRow {
  readonly tenantId: string;
  readonly slotId: string;
  readonly slotKind: string;
  readonly value: Record<string, unknown> | null;
  readonly writerId: string;
  readonly clock: number;
  readonly wallClockMs: number;
  readonly deleted: boolean;
  readonly version: Record<string, number>;
  /** Ordered projection-provenance surfaces (handoff breadcrumbs). */
  readonly projections: ReadonlyArray<string>;
}

/**
 * Narrow persistence seam the SQL repo drives. The gateway implements this
 * over a Drizzle client + the `blackboard_slots` table, binding the tenant RLS
 * GUC around each call. Every method is tenant-scoped — the repo NEVER reads
 * across tenants (RLS FORCE is the backstop, this is defence in depth).
 */
export interface SlotsDbPort {
  /** Read one slot row, or null if it has never been written. */
  getRow(tenantId: string, slotId: string): Promise<SlotRow | null>;
  /** Idempotent upsert keyed by (tenant_id, slot_id). */
  upsertRow(row: SlotRow): Promise<void>;
  /** List every slot row for a tenant (optionally filtered by kind). */
  listRows(
    tenantId: string,
    filter?: { readonly slotKind?: string },
  ): Promise<ReadonlyArray<SlotRow>>;
  /** Persist the projection-provenance chain for a slot. */
  setProjections(
    tenantId: string,
    slotId: string,
    projections: ReadonlyArray<string>,
  ): Promise<void>;
  /**
   * Serialise a read-merge-write for ONE slot (row lock). Optional: a port
   * that cannot lock returns `fn()` directly — the CRDT join still converges.
   */
  transact?<T>(slotId: string, fn: () => Promise<T>): Promise<T>;
}

function rowToSlot(row: SlotRow): Slot {
  return Object.freeze({
    tenantId: row.tenantId,
    slotId: row.slotId,
    slotKind: row.slotKind as SlotKind,
    value: row.value === null ? null : Object.freeze({ ...row.value }),
    writerId: row.writerId,
    clock: row.clock,
    wallClockMs: row.wallClockMs,
    deleted: row.deleted,
    version: Object.freeze({ ...row.version }),
  });
}

function slotToRow(
  slot: Slot,
  projections: ReadonlyArray<string>,
): SlotRow {
  return {
    tenantId: slot.tenantId,
    slotId: slot.slotId,
    slotKind: slot.slotKind,
    value: slot.value === null ? null : { ...slot.value },
    writerId: slot.writerId,
    clock: slot.clock,
    wallClockMs: slot.wallClockMs,
    deleted: slot.deleted,
    version: { ...slot.version },
    projections: projections.slice(),
  };
}

/**
 * Build the durable SQL-backed `SlotsRepository`. Pass the gateway's
 * {@link SlotsDbPort}; the CRDT merge + provenance bookkeeping live here.
 */
export function createSqlSlotsRepository(db: SlotsDbPort): SlotsRepository {
  function withLock<T>(slotId: string, fn: () => Promise<T>): Promise<T> {
    return db.transact ? db.transact(slotId, fn) : fn();
  }

  return {
    async get(tenantId, slotId) {
      const row = await db.getRow(tenantId, slotId);
      return row ? rowToSlot(row) : null;
    },

    async merge(incoming: Slot): Promise<Slot> {
      // Read-merge-write under a per-slot lock. The CRDT join is the conflict
      // resolver: existing ⊔ incoming. Idempotent — re-merging the same delta
      // is a no-op because mergeSlot(a, a) === a.
      return withLock(incoming.slotId, async () => {
        const existingRow = await db.getRow(incoming.tenantId, incoming.slotId);
        const converged =
          existingRow === null
            ? incoming
            : mergeSlot(rowToSlot(existingRow), incoming);
        // Preserve the existing projection chain across a value merge.
        const projections = existingRow?.projections ?? [];
        await db.upsertRow(slotToRow(converged, projections));
        return converged;
      });
    },

    async list(tenantId, filter) {
      const rows = await db.listRows(
        tenantId,
        filter?.slotKind ? { slotKind: filter.slotKind } : undefined,
      );
      return rows
        .map(rowToSlot)
        // Stable, deterministic ordering by slotId (parity with in-memory).
        .slice()
        .sort((a, b) => (a.slotId < b.slotId ? -1 : 1));
    },

    async recordProjection(tenantId, slotId, surface: SlotSurface) {
      return withLock(slotId, async () => {
        const row = await db.getRow(tenantId, slotId);
        const chain = row?.projections ?? [];
        // Idempotent: don't append a surface that is already the tail.
        if (chain[chain.length - 1] === surface) {
          return Object.freeze(chain.slice() as SlotSurface[]);
        }
        const next = [...chain, surface];
        await db.setProjections(tenantId, slotId, next);
        return Object.freeze(next.slice() as SlotSurface[]);
      });
    },

    async projectionsOf(tenantId, slotId) {
      const row = await db.getRow(tenantId, slotId);
      const chain = row?.projections ?? [];
      return Object.freeze(chain.slice() as SlotSurface[]);
    },
  };
}

/** Re-export for callers that want the row shape alongside the factory. */
export type { SlotKind };
