/**
 * YouTube connector persistence (Wave OMNI-P2).
 *
 * Companion to Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md.
 * Drizzle types for the youtube_videos table created by migration
 * 0047_selfimprove_omni_p2.sql.
 *
 * Distinct shape: keyed by (tenant, channel, video) instead of
 * (tenant, account, post). Stores view/like/comment counts and
 * duration; the rest of the social connectors store these in
 * `metrics jsonb`.
 *
 * Tenant-scoped with RLS via canonical `app.tenant_id` GUC policy.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  integer,
  bigint,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const youtubeVideos = pgTable(
  'youtube_videos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    channelId: text('channel_id').notNull(),
    videoId: text('video_id').notNull(),
    title: text('title'),
    description: text('description'),
    durationS: integer('duration_s'),
    viewCount: bigint('view_count', { mode: 'number' }),
    likeCount: bigint('like_count', { mode: 'number' }),
    commentCount: bigint('comment_count', { mode: 'number' }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    raw: jsonb('raw').notNull().default({}),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    tenantPublishedIdx: index('idx_youtube_videos_tenant_published').on(
      table.tenantId,
      table.publishedAt,
    ),
    tenantChannelVideoUnique: uniqueIndex(
      'uniq_youtube_videos_tenant_channel_video',
    ).on(table.tenantId, table.channelId, table.videoId),
  }),
);

export type YouTubeVideoRow = typeof youtubeVideos.$inferSelect;
export type NewYouTubeVideoRow = typeof youtubeVideos.$inferInsert;
