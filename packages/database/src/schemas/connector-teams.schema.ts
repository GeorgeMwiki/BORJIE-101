/**
 * Microsoft Teams connector persistence — Wave OMNI-P1.
 *
 * Companion to migration 0046_omni_p1.sql. Drizzle types for the
 * `teams_messages` table — channel messages and (lightweight) meeting
 * occurrences. Full recording bodies live in `zoom_meetings` (for
 * Zoom calls) or in a future Teams-meeting-recording table; this
 * table is the message+thread substrate.
 *
 * Tenant-scoped. RLS via `app.tenant_id`.
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

export const teamsMessages = pgTable(
  'teams_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Microsoft 365 tenant id (Azure AD tenant guid). */
    account: text('account').notNull(),
    teamId: text('team_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    /** Display name (kept for clarity); email/upn in `raw` is redacted. */
    fromUser: text('from_user').notNull(),
    content: text('content'),
    attachments: jsonb('attachments').notNull().default([]),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    raw: jsonb('raw').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantSentIdx: index('idx_teams_messages_tenant_sent').on(
      t.tenantId,
      t.sentAt,
    ),
    uq: uniqueIndex('teams_messages_uq').on(
      t.tenantId,
      t.account,
      t.teamId,
      t.channelId,
      t.messageId,
    ),
  }),
);

export type TeamsMessage = typeof teamsMessages.$inferSelect;
export type NewTeamsMessage = typeof teamsMessages.$inferInsert;
