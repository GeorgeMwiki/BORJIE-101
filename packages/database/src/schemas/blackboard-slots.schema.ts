/**
 * Blackboard cross-surface CRDT slots — durable persistence (EA-05 closure).
 *
 * Companion to the `SlotsRepository` port in `@borjie/blackboard-sota`
 * (slots/ + repositories/sql-slots-repository.ts). Drizzle types for the one
 * table created by migration 0319_blackboard_slots.sql:
 *
 *   - blackboardSlots → one row per (tenant_id, slot_id). A CRDT
 *     Last-Writer-Wins register over an arbitrary JSON `value`, paired with a
 *     `version` version-vector (per-actor Lamport counters) so the merge is a
 *     lattice-join (commutative / associative / idempotent). The winning
 *     register fields (`writer_id`, `clock`, `wall_clock_ms`, `deleted`) carry
 *     the LWW total-order key (clock → wall_clock_ms → writer_id). The
 *     `projections` array is the handoff provenance breadcrumb chain. The
 *     composite PK (tenant_id, slot_id) reproduces the kernel's
 *     `${tenantId}::${slotId}` isolation key + makes the upsert idempotent.
 *
 * The slot is the cross-surface state-bus spine: a decision/doc/task the MD
 * posts in chat lives ONCE here and re-projects (via the realtime state-bus
 * topic) onto owner-web + workforce-mobile + buyer-mobile. Tenant-scoped, RLS
 * (canonical `app.current_tenant_id` GUC + service-role bypass), migration
 * 0319. NULL-tenant rows are never written.
 *
 * The in-memory adapter ships with `@borjie/blackboard-sota`; this table backs
 * the DURABLE `createSqlSlotsRepository(...)` adapter, selected at the
 * composition root when a live DB handle is available.
 */

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  jsonb,
  timestamp,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ============================================================================
// blackboard_slots — the per-tenant cross-surface CRDT register store.
// ============================================================================

export const blackboardSlots = pgTable(
  'blackboard_slots',
  {
    tenantId: text('tenant_id').notNull(),
    /** Stable slot name, e.g. 'incident:KAH-088:decision'. */
    slotId: text('slot_id').notNull(),
    /** decision | document | task | draft | dataset | note (render hint). */
    slotKind: text('slot_kind').notNull(),
    /** The winning LWW register value. `null` == tombstoned (deleted). */
    value: jsonb('value').$type<Record<string, unknown> | null>(),
    /** The actor whose write currently holds the register. */
    writerId: text('writer_id').notNull(),
    /** Lamport clock of the winning write (LWW tie-break #1). */
    clock: integer('clock').notNull().default(0),
    /** Wall-clock ms of the winning write (LWW tie-break #2). */
    wallClockMs: bigint('wall_clock_ms', { mode: 'number' })
      .notNull()
      .default(0),
    /** True iff the slot is tombstoned. */
    deleted: boolean('deleted').notNull().default(false),
    /** Causal history across all actors — the CRDT version vector. */
    version: jsonb('version')
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    /** Ordered handoff provenance: surfaces this slot has been projected onto. */
    projections: jsonb('projections')
      .$type<ReadonlyArray<string>>()
      .notNull()
      .default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.slotId] }),
    /** List-by-tenant is the hydrate read (the surface loads every slot). */
    tenantIdx: index('idx_blackboard_slots_tenant').on(t.tenantId),
    /** Kind-filtered list (e.g. only `decision` slots for a surface lens). */
    tenantKindIdx: index('idx_blackboard_slots_tenant_kind').on(
      t.tenantId,
      t.slotKind,
    ),
  }),
);

export type BlackboardSlotRow = typeof blackboardSlots.$inferSelect;
export type NewBlackboardSlotRow = typeof blackboardSlots.$inferInsert;
