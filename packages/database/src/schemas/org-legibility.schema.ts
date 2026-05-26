/**
 * Org Legibility persistence (Wave M6).
 *
 * Companion to Docs/DESIGN/ORG_LEGIBILITY_SPEC.md §14-21. Drizzle types
 * for the two tables created by migration 0037_org_legibility.sql:
 *
 *   - legibilitySnapshots   → reconciled authoritative map per (tenant,
 *                              scope, snapshot_at). Public + internal
 *                              variants in separate columns; the
 *                              `internal_snapshot` column carries the
 *                              juniors axis and is never returned to
 *                              non-internal callers.
 *   - legibilityDeltas      → event-driven deltas applied forward to
 *                              rebuild the latest state. Bounded by a
 *                              check constraint to the documented
 *                              delta kinds.
 *
 * Both tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// legibility_snapshots — reconciled authoritative map
// ============================================================================

export const legibilitySnapshots = pgTable(
  'legibility_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    scopeId: text('scope_id').notNull(),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** PublicLegibilityMap envelope — safe to expose to humans. */
    snapshot: jsonb('snapshot').notNull(),
    /** InternalLegibilityMap envelope — juniors axis included. NULL if
     *  the writer did not compute the internal view. */
    internalSnapshot: jsonb('internal_snapshot'),
    /** Axes present in this snapshot (subset of the canonical 5). */
    axes: text('axes').array().notNull(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    scopeIdx: index('idx_legibility_snapshots_scope').on(
      table.tenantId,
      table.scopeId,
      table.snapshotAt,
    ),
    recentIdx: index('idx_legibility_snapshots_recent').on(
      table.tenantId,
      table.snapshotAt,
    ),
  }),
);

// ============================================================================
// legibility_deltas — event-driven deltas
// ============================================================================

export const legibilityDeltas = pgTable(
  'legibility_deltas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    scopeId: text('scope_id').notNull(),
    /**
     * person.added | person.removed |
     * role.granted | role.revoked |
     * scope.added | scope.archived |
     * capability.activated | capability.retired |
     * work.started | work.completed | work.blocked |
     * junior.assigned | junior.released |
     * reconciliation.divergence
     */
    deltaKind: text('delta_kind').notNull(),
    payload: jsonb('payload').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    scopeIdx: index('idx_legibility_deltas_scope').on(
      table.tenantId,
      table.scopeId,
      table.recordedAt,
    ),
    kindIdx: index('idx_legibility_deltas_kind').on(
      table.tenantId,
      table.deltaKind,
      table.recordedAt,
    ),
    recentIdx: index('idx_legibility_deltas_recent').on(
      table.tenantId,
      table.recordedAt,
    ),
  }),
);

// ============================================================================
// Inferred types — public surface
// ============================================================================

export type LegibilitySnapshotRow = typeof legibilitySnapshots.$inferSelect;
export type NewLegibilitySnapshotRow = typeof legibilitySnapshots.$inferInsert;

export type LegibilityDeltaRow = typeof legibilityDeltas.$inferSelect;
export type NewLegibilityDeltaRow = typeof legibilityDeltas.$inferInsert;
