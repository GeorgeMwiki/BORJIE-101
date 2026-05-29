/**
 * Pinned Items - Wave SUPERPOWERS (migration 0113).
 *
 * Companion to:
 *   - packages/database/src/migrations/0113_pinned_items.sql
 *   - services/api-gateway/src/routes/owner/pinned-items.hono.ts
 *
 * Per-owner quick-access strip above the dashboard. Mr. Mwikila pins
 * frequently-referenced entities via the `mining.ui.bookmark` tool;
 * the owner drag-reorders. `unpinned_at` is set in place rather than
 * deleting so a repinned chip keeps its history.
 *
 * Tenant-scoped + owner-scoped. RLS FORCE-enabled.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const PIN_ENTITY_TYPES = [
  'licence',
  'royalty_filing',
  'site',
  'counterparty',
  'document',
  'draft',
  'reminder',
  'shipment',
] as const;
export type PinEntityType = (typeof PIN_ENTITY_TYPES)[number];

export const pinnedItems = pgTable(
  'pinned_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    ownerId: text('owner_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    label: text('label').notNull(),
    position: integer('position').notNull().default(0),
    /**
     * Optional folder grouping (migration 0133). NULL ⇒ ungrouped; renders
     * at the head of the strip. Members of the same folderId render as a
     * collapsible section with `folderLabel` as the header.
     */
    folderId: uuid('folder_id'),
    /**
     * Denormalised folder name so the strip renders the section header
     * without a second query. Updated whenever the folder is renamed.
     */
    folderLabel: text('folder_label'),
    pinnedAt: timestamp('pinned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    unpinnedAt: timestamp('unpinned_at', { withTimezone: true }),
    provenance: jsonb('provenance').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ownerEntityActiveIdx: uniqueIndex(
      'pinned_items_owner_entity_active_idx',
    ).on(table.tenantId, table.ownerId, table.entityType, table.entityId),
    ownerPositionIdx: index('pinned_items_owner_position_idx').on(
      table.tenantId,
      table.ownerId,
      table.position,
      table.pinnedAt,
    ),
    ownerFolderIdx: index('pinned_items_owner_folder_idx').on(
      table.tenantId,
      table.ownerId,
      table.folderId,
      table.position,
    ),
  }),
);

export type PinnedItem = typeof pinnedItems.$inferSelect;
export type NewPinnedItem = typeof pinnedItems.$inferInsert;
