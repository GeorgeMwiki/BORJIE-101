/**
 * MDR (Mr. Mwikila — Mr. Mwikila District Resident) Plan items.
 *
 * Phase E.7 — owner-visible, steerable plan tree. Hierarchical schedule
 * proposed/maintained by the MD, accepted/rejected/edited by the owner.
 *
 * Horizons cascade annual → quarterly → monthly → weekly → daily; the
 * `parent_id` self-reference forms the tree. Root rows have parent_id
 * NULL and horizon = 'annual'.
 *
 * Idempotent: status mutations use UPDATE, not INSERT. Cancelled rows
 * stay in the table (soft-delete via status='cancelled') for audit.
 */

import {
  pgTable,
  text,
  uuid,
  jsonb,
  timestamp,
  boolean,
  index,
} from 'drizzle-orm/pg-core';

export const mdrPlanItems = pgTable(
  'mdr_plan_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    /** null for root annual items; otherwise the parent row's id. */
    parentId: uuid('parent_id'),
    /** 'annual' | 'quarterly' | 'monthly' | 'weekly' | 'daily' */
    horizon: text('horizon').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    /** 'proposed' | 'active' | 'paused' | 'done' | 'cancelled' */
    status: text('status').notNull(),
    /** 'md' | 'owner' */
    proposedBy: text('proposed_by').notNull(),
    // D2 — withTimezone:true required so the Drizzle declarator matches the
    // timestamptz column installed by migration 0163 (otherwise downstream
    // consumers cannot tell a TZ-aware column from a naive one — type-safety leak).
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    /** ISO date — kept as TEXT for timezone-free planning. */
    startDate: text('start_date'),
    dueDate: text('due_date'),
    ownerEditable: boolean('owner_editable').notNull().default(true),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantHorizonIdx: index('idx_mdr_plan_tenant_horizon').on(
      t.tenantId,
      t.horizon,
    ),
    tenantParentIdx: index('idx_mdr_plan_tenant_parent').on(
      t.tenantId,
      t.parentId,
    ),
    statusIdx: index('idx_mdr_plan_status').on(t.tenantId, t.status),
  }),
);

export type MdrPlanItemRow = typeof mdrPlanItems.$inferSelect;
export type NewMdrPlanItemRow = typeof mdrPlanItems.$inferInsert;
