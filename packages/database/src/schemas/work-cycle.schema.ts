/**
 * Continuous 24/7 Work Cycle persistence (Wave M1).
 *
 * Companion to docs/DESIGN/CONTINUOUS_24_7_WORK_CYCLE_SPEC.md. Drizzle
 * types for the 2 tables created by migration 0061_work_cycle.sql
 * (renumbered from 0033 to resolve collision with
 * 0033_mcp_external_connections.sql; alphabetic precedence keeps
 * mcp_external_connections at slot 0033):
 *
 *   - workCycleJournal — append-only journal of every tick. One row per
 *                        tick. Hash-chained via (prev_hash, audit_hash).
 *                        Tenant-scoped, RLS-bound. Per-tenant tick_no
 *                        unique (idempotency anchor).
 *   - workCycleState   — one row per tenant. Holds last_tick_no,
 *                        last_tick_at, current_mode, pending_threads.
 *                        Tenant-scoped, RLS-bound. Updated atomically
 *                        with each journal append.
 *
 * Both tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// work_cycle_journal — append-only journal of every tick
// ============================================================================

export const workCycleJournal = pgTable(
  'work_cycle_journal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Per-tenant monotone tick counter. Unique with tenant_id. */
    tickNo: bigint('tick_no', { mode: 'bigint' }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    /** 'idle' | 'active' | 'night' | 'observe'. */
    mode: text('mode').notNull(),
    /** TickInput payload (frozen at run-start). */
    inputs: jsonb('inputs').notNull(),
    /** TickOutput payload (status, kind, summary, artifact_refs, ...). */
    outputs: jsonb('outputs').notNull(),
    costUsdCents: integer('cost_usd_cents').notNull().default(0),
    auditHash: text('audit_hash').notNull(),
    /** Previous row's audit_hash, or NULL for the first tick. */
    prevHash: text('prev_hash'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantTickUnique: uniqueIndex('uq_wcj_tenant_tick').on(t.tenantId, t.tickNo),
    tenantStartedIdx: index('idx_wcj_tenant_started').on(
      t.tenantId,
      t.startedAt,
    ),
    tenantModeIdx: index('idx_wcj_tenant_mode').on(
      t.tenantId,
      t.mode,
      t.startedAt,
    ),
  }),
);

export type WorkCycleJournalRow = typeof workCycleJournal.$inferSelect;
export type WorkCycleJournalInsert = typeof workCycleJournal.$inferInsert;

// ============================================================================
// work_cycle_state — one row per tenant, holds resumption pointer
// ============================================================================

export const workCycleState = pgTable(
  'work_cycle_state',
  {
    tenantId: text('tenant_id').primaryKey(),
    lastTickNo: bigint('last_tick_no', { mode: 'bigint' })
      .notNull()
      .default(0n),
    lastTickAt: timestamp('last_tick_at', { withTimezone: true }),
    /** 'idle' | 'active' | 'night' | 'observe'. Default 'idle'. */
    currentMode: text('current_mode').notNull().default('idle'),
    /** Slow-burn investigations in flight (id + title pairs). */
    pendingThreads: jsonb('pending_threads').notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    lastTickIdx: index('idx_wcs_last_tick_at').on(t.lastTickAt),
  }),
);

export type WorkCycleStateRow = typeof workCycleState.$inferSelect;
export type WorkCycleStateInsert = typeof workCycleState.$inferInsert;
