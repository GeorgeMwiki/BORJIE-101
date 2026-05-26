/**
 * Facebook connector persistence (Wave OMNI-P2).
 *
 * Companion to Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md.
 * Drizzle types for the facebook_posts table created by migration
 * 0047_selfimprove_omni_p2.sql. Tenant-scoped with RLS.
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

export const facebookPosts = pgTable(
  'facebook_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    account: text('account').notNull(),
    postId: text('post_id').notNull(),
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
    tenantPostedIdx: index('idx_facebook_posts_tenant_posted').on(
      table.tenantId,
      table.postedAt,
    ),
    tenantAccountPostUnique: uniqueIndex('uniq_facebook_posts_tenant_account_post').on(
      table.tenantId,
      table.account,
      table.postId,
    ),
  }),
);

export type FacebookPostRow = typeof facebookPosts.$inferSelect;
export type NewFacebookPostRow = typeof facebookPosts.$inferInsert;
