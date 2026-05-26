/**
 * Instagram connector persistence (Wave OMNI-P2).
 *
 * Companion to Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md.
 * Drizzle types for the instagram_posts table created by migration
 * 0047_selfimprove_omni_p2.sql.
 *
 * Tenant-scoped with RLS via canonical `app.tenant_id` GUC policy.
 * UNIQUE (tenant_id, account, post_id) enforces idempotency.
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

export const instagramPosts = pgTable(
  'instagram_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    account: text('account').notNull(),
    postId: text('post_id').notNull(),
    /** image | video | carousel_album | reels | story. */
    kind: text('kind').notNull(),
    caption: text('caption'),
    mediaUrls: text('media_urls').array().notNull().default([]),
    metrics: jsonb('metrics').notNull().default({}),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    raw: jsonb('raw').notNull().default({}),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    tenantPostedIdx: index('idx_instagram_posts_tenant_posted').on(
      table.tenantId,
      table.postedAt,
    ),
    tenantAccountPostUnique: uniqueIndex('uniq_instagram_posts_tenant_account_post').on(
      table.tenantId,
      table.account,
      table.postId,
    ),
  }),
);

export type InstagramPostRow = typeof instagramPosts.$inferSelect;
export type NewInstagramPostRow = typeof instagramPosts.$inferInsert;
