/**
 * Tab-as-Loop persistence (Wave M5).
 *
 * Companion to Docs/DESIGN/TAB_AS_LOOP_SPEC.md §12-19. Drizzle types
 * for the two tables created by migration 0036_tab_as_loop.sql:
 *
 *   - tabSessions  → one row per (user, tab_kind, scope) — the
 *                     server-anchored persistent tab. Canonical state
 *                     in `state` jsonb; lifecycle timestamps; hash-
 *                     chained for tamper evidence. Tenant-scoped, RLS.
 *   - tabEvents    → one row per applied client→server delta. Replayed
 *                     in `iteration` order on rehydrate. Tenant-scoped,
 *                     RLS.
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
  bigint,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// tab_sessions — server-anchored persistent tabs
// ============================================================================

export const tabSessions = pgTable(
  'tab_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    /** composer | workflow | dashboard | insight | admin | owner | worker | customer */
    tabKind: text('tab_kind').notNull(),
    /** Canonical TabState envelope (recipeId, uiState, loopCursor, …). */
    state: jsonb('state').notNull(),
    /** opening | hydrating | active | paused | expiring | closed */
    lifecycleState: text('lifecycle_state').notNull().default('opening'),
    openedAt: timestamp('opened_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    auditHash: text('audit_hash').notNull(),
    prevHash: text('prev_hash').notNull(),
  },
  (table) => ({
    userIdx: index('idx_tab_sessions_user').on(
      table.tenantId,
      table.userId,
      table.lifecycleState,
    ),
    activeIdx: index('idx_tab_sessions_active').on(
      table.tenantId,
      table.lifecycleState,
      table.openedAt,
    ),
    expiringIdx: index('idx_tab_sessions_expiring').on(
      table.tenantId,
      table.expiresAt,
    ),
    kindIdx: index('idx_tab_sessions_kind').on(
      table.tenantId,
      table.tabKind,
      table.openedAt,
    ),
  }),
);

// ============================================================================
// tab_events — per-delta event log
// ============================================================================

export const tabEvents = pgTable(
  'tab_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tabSessionId: uuid('tab_session_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    /** ui.field-edit | loop.iteration-done | hint.acknowledge | friction.sample | recipe.proposal | lifecycle.transition */
    eventKind: text('event_kind').notNull(),
    /** Monotonic iteration counter; ascending within a session. */
    iteration: bigint('iteration', { mode: 'number' }).notNull(),
    payload: jsonb('payload').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    sessionIdx: index('idx_tab_events_session').on(
      table.tabSessionId,
      table.iteration,
    ),
    tenantRecentIdx: index('idx_tab_events_tenant_recent').on(
      table.tenantId,
      table.recordedAt,
    ),
    kindIdx: index('idx_tab_events_kind').on(
      table.tenantId,
      table.eventKind,
      table.recordedAt,
    ),
  }),
);

// ============================================================================
// Inferred types — public surface
// ============================================================================

export type TabSessionRow = typeof tabSessions.$inferSelect;
export type NewTabSessionRow = typeof tabSessions.$inferInsert;

export type TabEventRow = typeof tabEvents.$inferSelect;
export type NewTabEventRow = typeof tabEvents.$inferInsert;
