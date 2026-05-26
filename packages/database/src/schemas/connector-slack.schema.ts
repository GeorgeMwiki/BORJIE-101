/**
 * Omnidata P0 Batch 1 — Slack canonical messages.
 *
 * Companion to `Docs/DESIGN/OMNI_P0_BATCH1_CONNECTORS_SPEC.md` and
 * migration `0042_omni_p0_batch1.sql`. Drizzle types for the
 * shared `connector_credentials` + `connector_cursors` tables and
 * the slack-kind `slack_messages` canonical row table.
 *
 * Every table is tenant-scoped via the canonical `app.tenant_id`
 * GUC RLS policy. The two shared tables (`connector_credentials`,
 * `connector_cursors`) are declared here once and re-exported from
 * the email + calendar schemas so consumers can import from any of
 * the three without re-introducing duplicate Drizzle table objects.
 *
 * Token columns (`access_token_enc`, `refresh_token_enc`) are
 * `bytea` carrying AES-GCM ciphertext sealed with a tenant-bound
 * DEK. The Drizzle binding is `Uint8Array`; nothing in this schema
 * sees plaintext.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  customType,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

/**
 * Custom drizzle column wrapping Postgres `bytea`. Binds to
 * `Uint8Array` in TypeScript. The driver delivers a `Buffer`
 * which we widen to `Uint8Array` for portability.
 */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value) {
    return Buffer.from(value);
  },
  fromDriver(value) {
    return new Uint8Array(value);
  },
});

// ============================================================================
// connector_credentials — per-tenant per-account OAuth state
// ============================================================================

export const connectorCredentials = pgTable(
  'connector_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** slack | gmail | outlook_mail | google_calendar | outlook_calendar */
    connectorKind: text('connector_kind').notNull(),
    /** Provider-side account id (Slack workspace id, email address, …). */
    connectorAccount: text('connector_account').notNull(),
    /** ENCRYPTED-AT-REST. AES-GCM ciphertext sealed with tenant DEK. */
    accessTokenEnc: bytea('access_token_enc'),
    /** ENCRYPTED-AT-REST. AES-GCM ciphertext sealed with tenant DEK. */
    refreshTokenEnc: bytea('refresh_token_enc'),
    scopes: text('scopes').array().notNull().default([]),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantKindIdx: index('idx_connector_creds_tenant_kind').on(
      t.tenantId,
      t.connectorKind,
    ),
  }),
);

export type ConnectorCredentialsRow = typeof connectorCredentials.$inferSelect;
export type ConnectorCredentialsInsert = typeof connectorCredentials.$inferInsert;

// ============================================================================
// connector_cursors — per (tenant, kind, account) incremental cursor
// ============================================================================

export const connectorCursors = pgTable(
  'connector_cursors',
  {
    tenantId: text('tenant_id').notNull(),
    connectorKind: text('connector_kind').notNull(),
    connectorAccount: text('connector_account').notNull(),
    cursor: text('cursor'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.tenantId, t.connectorKind, t.connectorAccount],
    }),
  }),
);

export type ConnectorCursorRow = typeof connectorCursors.$inferSelect;
export type ConnectorCursorInsert = typeof connectorCursors.$inferInsert;

// ============================================================================
// slack_messages — canonical Slack message rows (post-redaction)
// ============================================================================

export const slackMessages = pgTable(
  'slack_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    channelId: text('channel_id').notNull(),
    ts: text('ts').notNull(),
    userId: text('user_id'),
    text: text('text'),
    threadTs: text('thread_ts'),
    reactions: jsonb('reactions').notNull().default([]),
    files: jsonb('files').notNull().default([]),
    raw: jsonb('raw').notNull().default({}),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantIngestedIdx: index('idx_slack_messages_tenant_ingested').on(
      t.tenantId,
      t.ingestedAt,
    ),
  }),
);

export type SlackMessageRow = typeof slackMessages.$inferSelect;
export type SlackMessageInsert = typeof slackMessages.$inferInsert;
