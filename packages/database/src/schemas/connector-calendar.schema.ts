/**
 * Omnidata P0 Batch 1 — Calendar canonical events (Google + Outlook).
 *
 * Companion to `Docs/DESIGN/OMNI_P0_BATCH1_CONNECTORS_SPEC.md` and
 * migration `0042_omni_p0_batch1.sql`. Drizzle types for the
 * `calendar_events` canonical row table.
 *
 * Recurring instances each materialise as separate rows with their
 * `originalStartTime` baked into `event_id` so the
 * `UNIQUE(tenant_id, provider, account, calendar_id, event_id)`
 * dedup stays stable across edits.
 *
 * Attendee email addresses inside `attendees` are post-redaction
 * salted-sha256 hashes.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export {
  connectorCredentials,
  connectorCursors,
  type ConnectorCredentialsRow,
  type ConnectorCredentialsInsert,
  type ConnectorCursorRow,
  type ConnectorCursorInsert,
} from './connector-slack.schema.js';

// ============================================================================
// calendar_events — canonical calendar event rows (post-redaction)
// ============================================================================

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** google_calendar | outlook_calendar */
    provider: text('provider').notNull(),
    account: text('account').notNull(),
    calendarId: text('calendar_id').notNull(),
    eventId: text('event_id').notNull(),
    summary: text('summary'),
    description: text('description'),
    startAt: timestamp('start_at', { withTimezone: true }),
    endAt: timestamp('end_at', { withTimezone: true }),
    attendees: jsonb('attendees').notNull().default([]),
    raw: jsonb('raw').notNull().default({}),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantStartIdx: index('idx_calendar_events_tenant_start').on(
      t.tenantId,
      t.startAt,
    ),
    tenantIngestedIdx: index('idx_calendar_events_tenant_ingested').on(
      t.tenantId,
      t.ingestedAt,
    ),
  }),
);

export type CalendarEventRow = typeof calendarEvents.$inferSelect;
export type CalendarEventInsert = typeof calendarEvents.$inferInsert;
