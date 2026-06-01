/**
 * owner_tabs_structural — server-PERSISTED, per-tab structural store for the
 * owner cockpit tab strip.
 *
 * Companion to migration 0169_owner_tabs_structural.sql.
 *
 * The legacy `owner_tabs` table (migration 0089 / owner-tabs.schema.ts) stores
 * the WHOLE strip as a single opaque jsonb document ("the FE owns the schema"),
 * so structural tab operations the brain emits from chat (pin / reorder / remove)
 * were FE-chip-only: nothing on the server could spawn / pin / reorder / remove a
 * tab durably. This table promotes tab structure to a DURABLE, QUERYABLE row set
 * — one row per (tenant_id, user_id, tab_id) — that the action-executor
 * `manage_tab` verb writes directly.
 *
 * Money path (CLAUDE.md hard rule)
 * --------------------------------
 * This table carries NO money column BY DESIGN — it is pure UI structure
 * (label / position / pinned / kind / config). Soft-delete (`status='removed'`)
 * preserves the row for undo/audit instead of hard-deleting it.
 *
 * Tenant-isolation: RLS FORCE-enabled in migration 0169 on
 * `current_setting('app.current_tenant_id', true)` (mirrors 0164). The
 * action-executor additionally predicates on `user_id` in every query
 * (belt-and-braces).
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { provenanceColumn } from '../helpers/provenance-column.js';

// ============================================================================
// owner_tabs_structural — one row per tab in an owner's cockpit strip
// ============================================================================

export const ownerTabsStructural = pgTable(
  'owner_tabs_structural',
  {
    id: text('id').primaryKey(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /** The owner whose strip this tab belongs to (per-user scoping). */
    userId: text('user_id').notNull(),
    /** Stable client/chat tab id (the FE store + chat chips both key on this). */
    tabId: text('tab_id').notNull(),
    label: text('label').notNull(),
    /** Zero-based slot in the strip. */
    position: integer('position').notNull().default(0),
    pinned: boolean('pinned').notNull().default(false),
    /** 'system' tabs cannot be removed; 'custom' tabs can (CHECK in 0169). */
    kind: text('kind').notNull().default('custom'),
    /** Flexible per-tab options bag (query/filters/title). NEVER money. */
    config: jsonb('config').notNull().default({}),
    /** 'active' | 'removed' — soft-delete preserves the row (CHECK in 0169). */
    status: text('status').notNull().default('active'),
    /** Chat-as-OS provenance ({via, actorId, requestedAt, ...}). */
    provenance: provenanceColumn(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // A tab id is unique within an owner's strip: spawn is idempotent and
    // update/remove/reorder/pin target exactly one row.
    tenantUserTabIdx: uniqueIndex('owner_tabs_structural_tenant_user_tab_idx').on(
      t.tenantId,
      t.userId,
      t.tabId,
    ),
    // Hydrate hot path: an owner's ACTIVE tabs in strip order.
    tenantUserStatusIdx: index(
      'owner_tabs_structural_tenant_user_status_idx',
    ).on(t.tenantId, t.userId, t.status, t.position),
  }),
);

export type OwnerTabStructuralRow = typeof ownerTabsStructural.$inferSelect;
export type OwnerTabStructuralInsert = typeof ownerTabsStructural.$inferInsert;

/** Closed set of tab kinds (mirrors the 0169 CHECK constraint). */
export const OWNER_TAB_KINDS = ['system', 'custom'] as const;
export type OwnerTabKind = (typeof OWNER_TAB_KINDS)[number];

/** Closed set of tab statuses (mirrors the 0169 CHECK constraint). */
export const OWNER_TAB_STATUSES = ['active', 'removed'] as const;
export type OwnerTabStatus = (typeof OWNER_TAB_STATUSES)[number];
