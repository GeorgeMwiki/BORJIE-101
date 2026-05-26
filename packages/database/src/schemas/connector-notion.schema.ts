/**
 * Notion ingest tables (OMNI-P0-BATCH-2).
 *
 * Companion to `Docs/DESIGN/OMNI_P0_BATCH2_CONNECTORS_SPEC.md`.
 *
 * Drizzle types for the two Notion tables in migration
 * `0043_omni_p0_batch2.sql`:
 *
 *   - notionPages  → page metadata + property bag.
 *                    UNIQUE on (tenant_id, workspace_id, page_id).
 *                    Tenant-scoped, RLS.
 *   - notionBlocks → recursive block tree (incl. comments as
 *                    kind='comment'). UNIQUE on
 *                    (tenant_id, workspace_id, block_id). Tenant-scoped, RLS.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// notion_pages
// ============================================================================

export const notionPages = pgTable(
  'notion_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    /** Notion's `page` UUID. */
    pageId: text('page_id').notNull(),
    /** Notion parent id (page / database / workspace). Null for workspace-root pages. */
    parentId: text('parent_id'),
    /** Plain-text title, salted-hash redaction applied for PII matches. */
    title: text('title'),
    /** Property bag — keys preserved, values redacted where they look like PII. */
    properties: jsonb('properties').notNull().default({}),
    lastEditedAt: timestamp('last_edited_at', { withTimezone: true }).notNull(),
    /** Original upstream payload — retained for legal hold + replay. */
    raw: jsonb('raw').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantEditedIdx: index('idx_notion_pages_tenant_edited').on(
      t.tenantId,
      t.lastEditedAt,
    ),
    parentIdx: index('idx_notion_pages_parent').on(
      t.tenantId,
      t.workspaceId,
      t.parentId,
    ),
    uniqTenantPage: uniqueIndex('notion_pages_tenant_uniq').on(
      t.tenantId,
      t.workspaceId,
      t.pageId,
    ),
  }),
);

// ============================================================================
// notion_blocks
// ============================================================================

export const notionBlocks = pgTable(
  'notion_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    /** Notion block UUID. */
    blockId: text('block_id').notNull(),
    /** Notion parent block / page id. */
    parentId: text('parent_id'),
    /** Collapsed kind — see spec section 4.4 for the mapping. */
    kind: text('kind').notNull(),
    /** Canonical content projection — rich-text flattened, redacted. */
    content: jsonb('content').notNull().default({}),
    lastEditedAt: timestamp('last_edited_at', { withTimezone: true }).notNull(),
    raw: jsonb('raw').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantEditedIdx: index('idx_notion_blocks_tenant_edited').on(
      t.tenantId,
      t.lastEditedAt,
    ),
    parentIdx: index('idx_notion_blocks_parent').on(
      t.tenantId,
      t.workspaceId,
      t.parentId,
    ),
    uniqTenantBlock: uniqueIndex('notion_blocks_tenant_uniq').on(
      t.tenantId,
      t.workspaceId,
      t.blockId,
    ),
  }),
);

export type NotionPage = typeof notionPages.$inferSelect;
export type NewNotionPage = typeof notionPages.$inferInsert;
export type NotionBlock = typeof notionBlocks.$inferSelect;
export type NewNotionBlock = typeof notionBlocks.$inferInsert;
