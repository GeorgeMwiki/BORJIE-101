/**
 * Owner Dashboard Layout — Wave BRAIN-UI-CONTROL.
 *
 * Companion to:
 *   - packages/database/src/migrations/0097_brain_ui_control.sql
 *   - services/api-gateway/src/routes/owner/dashboard-layout.hono.ts
 *   - apps/owner-web/src/components/dashboard/DashboardComposer.tsx
 *
 * One row per (tenant_id, user_id). Stores the owner's chosen tile
 * ordering, hidden tiles, and sidebar nav ordering. Both the owner and
 * the brain can mutate it; the brain mutates through the `<dashboard_
 * compose>` / `<nav_rearrange>` Accept flow and stamps `updated_by =
 * 'brain'` so audits can trace authorship.
 *
 * Tenant-scoped via `app.tenant_id` GUC RLS. FORCE RLS per CLAUDE.md.
 */

import { pgTable, text, timestamp, jsonb, primaryKey } from 'drizzle-orm/pg-core';

export const ownerDashboardLayout = pgTable(
  'owner_dashboard_layout',
  {
    tenantId: text('tenant_id').notNull(),
    /** Supabase user id of the owner whose layout this row describes. */
    userId: text('user_id').notNull(),
    /** Ordered list of dashboard tile ids (top-first). */
    tileOrder: jsonb('tile_order').notNull().default([]),
    /** Tile ids the composer should hide entirely. */
    hiddenTiles: jsonb('hidden_tiles').notNull().default([]),
    /** Ordered list of sidebar nav item hrefs (top-first). */
    sidebarOrder: jsonb('sidebar_order').notNull().default([]),
    /** Free-form metadata (brain reason text, audit pointer, etc.). */
    metadata: jsonb('metadata').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Author of the last update: 'owner' | 'brain'. */
    updatedBy: text('updated_by').notNull().default('owner'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.userId] }),
  }),
);

export type OwnerDashboardLayoutRow = typeof ownerDashboardLayout.$inferSelect;
export type OwnerDashboardLayoutInsert = typeof ownerDashboardLayout.$inferInsert;
