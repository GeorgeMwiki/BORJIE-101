/**
 * Zoom connector persistence — Wave OMNI-P1.
 *
 * Companion to migration 0046_omni_p1.sql. Drizzle types for the
 * `zoom_meetings` table.
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

export const zoomMeetings = pgTable(
  'zoom_meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Zoom account id (organisation-scope). */
    account: text('account').notNull(),
    meetingId: text('meeting_id').notNull(),
    topic: text('topic'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }),
    /** Array of `{name, hashedEmail, joinedAt, leftAt}` after redaction. */
    participants: jsonb('participants').notNull().default([]),
    recordingUri: text('recording_uri'),
    transcriptText: text('transcript_text'),
    raw: jsonb('raw').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantStartIdx: index('idx_zoom_meetings_tenant_start').on(
      t.tenantId,
      t.startAt,
    ),
    uq: uniqueIndex('zoom_meetings_uq').on(
      t.tenantId,
      t.account,
      t.meetingId,
    ),
  }),
);

export type ZoomMeeting = typeof zoomMeetings.$inferSelect;
export type NewZoomMeeting = typeof zoomMeetings.$inferInsert;
