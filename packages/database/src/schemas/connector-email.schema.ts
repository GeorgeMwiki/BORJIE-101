/**
 * Omnidata P0 Batch 1 — Email canonical messages (Gmail + Outlook).
 *
 * Companion to `Docs/DESIGN/OMNI_P0_BATCH1_CONNECTORS_SPEC.md` and
 * migration `0042_omni_p0_batch1.sql`. Drizzle types for the
 * `email_messages` canonical row table.
 *
 * `from_addr` and `to_addrs` are post-redaction salted-sha256 hashes;
 * raw plaintext email addresses NEVER land in this table. Attachments
 * are stored in MinIO (see spec §4.2); only the storage URL + content
 * hash live in the `attachments` jsonb.
 *
 * The shared `connectorCredentials` and `connectorCursors` tables are
 * declared in `connector-slack.schema.ts` and re-exported below so a
 * single import surface stays usable from the email side.
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
// email_messages — canonical email rows (post-redaction)
// ============================================================================

export const emailMessages = pgTable(
  'email_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** gmail | outlook_mail */
    provider: text('provider').notNull(),
    account: text('account').notNull(),
    messageId: text('message_id').notNull(),
    threadId: text('thread_id'),
    /** Post-redaction salted-sha256 hash. */
    fromAddr: text('from_addr'),
    /** Post-redaction salted-sha256 hashes. */
    toAddrs: text('to_addrs').array().notNull().default([]),
    subject: text('subject'),
    bodyText: text('body_text'),
    bodyHtml: text('body_html'),
    attachments: jsonb('attachments').notNull().default([]),
    raw: jsonb('raw').notNull().default({}),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantIngestedIdx: index('idx_email_messages_tenant_ingested').on(
      t.tenantId,
      t.ingestedAt,
    ),
    threadIdx: index('idx_email_messages_thread').on(
      t.tenantId,
      t.provider,
      t.account,
      t.threadId,
    ),
  }),
);

export type EmailMessageRow = typeof emailMessages.$inferSelect;
export type EmailMessageInsert = typeof emailMessages.$inferInsert;
