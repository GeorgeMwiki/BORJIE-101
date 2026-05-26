/**
 * Google Drive ingest table (OMNI-P0-BATCH-2).
 *
 * Companion to `Docs/DESIGN/OMNI_P0_BATCH2_CONNECTORS_SPEC.md`.
 *
 * Drizzle types for the Drive table in migration
 * `0043_omni_p0_batch2.sql`:
 *
 *   - driveFiles → file metadata + extracted plain text for native
 *                  Google formats (gdoc / gsheet / gslide). UNIQUE on
 *                  (tenant_id, account, file_id). Tenant-scoped, RLS.
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
// drive_files
// ============================================================================

export const driveFiles = pgTable(
  'drive_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Google account email (lower-cased). One Drive token per account. */
    account: text('account').notNull(),
    /** Stable Drive file id. */
    fileId: text('file_id').notNull(),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    /** Drive parents — text[] of folder ids. */
    parents: text('parents')
      .array()
      .notNull()
      .default([]),
    modifiedAt: timestamp('modified_at', { withTimezone: true }).notNull(),
    /** Plain text extracted via /v3/files/{id}/export (native types only). */
    extractedText: text('extracted_text'),
    raw: jsonb('raw').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantModifiedIdx: index('idx_drive_files_tenant_modified').on(
      t.tenantId,
      t.modifiedAt,
    ),
    mimeIdx: index('idx_drive_files_mime').on(t.tenantId, t.mimeType),
    uniqTenantFile: uniqueIndex('drive_files_tenant_uniq').on(
      t.tenantId,
      t.account,
      t.fileId,
    ),
  }),
);

export type DriveFile = typeof driveFiles.$inferSelect;
export type NewDriveFile = typeof driveFiles.$inferInsert;
