/**
 * Owner Tabs — Wave OWNER-OS.
 *
 * Companion to:
 *   - packages/database/src/migrations/0089_owner_reminders_and_tabs.sql
 *   - services/api-gateway/src/routes/owner/tabs.hono.ts
 *   - apps/owner-web/src/lib/owner-tabs-store.ts
 *
 * One Drizzle table:
 *
 *   owner_tabs — per-user dashboard tab strip state. One row per
 *                (tenant_id, user_id). Stored as a single jsonb document
 *                so the FE zustand store can hydrate + persist in one
 *                round-trip. The FE owns the schema of `state`.
 *
 * Tenant-scoped via `app.tenant_id` GUC RLS. FORCE RLS per CLAUDE.md.
 */

import { pgTable, text, timestamp, jsonb, primaryKey } from 'drizzle-orm/pg-core';

export const ownerTabs = pgTable(
  'owner_tabs',
  {
    tenantId: text('tenant_id').notNull(),
    /** Supabase user id of the owner whose tab layout this row holds. */
    userId: text('user_id').notNull(),
    /** Free-form jsonb shape — FE owns the schema. Default = one Chat tab. */
    state: jsonb('state').notNull().default({ tabs: [], activeTabId: null }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.userId] }),
  }),
);

export type OwnerTabsRow = typeof ownerTabs.$inferSelect;
export type OwnerTabsInsert = typeof ownerTabs.$inferInsert;
