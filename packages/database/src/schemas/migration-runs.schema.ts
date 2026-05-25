/**
 * Migration Runs schema — tracks bulk onboarding lifecycle.
 *
 * One row per uploaded file; status transitions:
 *   uploaded → extracted → diffed → approved → committing → committed
 *                                                        ↘ failed
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';

export const migrationRunStatusEnum = pgEnum('migration_run_status', [
  'uploaded',
  'extracted',
  'diffed',
  'approved',
  'committing',
  'committed',
  'failed',
]);

export const migrationRuns = pgTable(
  'migration_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').notNull(),

    status: migrationRunStatusEnum('status').notNull().default('uploaded'),

    uploadFilename: text('upload_filename'),
    uploadMimeType: text('upload_mime_type'),
    uploadSizeBytes: integer('upload_size_bytes'),

    extractionSummary: jsonb('extraction_summary'),
    diffSummary: jsonb('diff_summary'),
    committedSummary: jsonb('committed_summary'),
    bundle: jsonb('bundle'),

    errorMessage: text('error_message'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (table) => ({
    tenantIdx: index('migration_runs_tenant_idx').on(table.tenantId),
    statusIdx: index('migration_runs_status_idx').on(table.status),
    tenantStatusIdx: index('migration_runs_tenant_status_idx').on(
      table.tenantId,
      table.status
    ),
    createdAtIdx: index('migration_runs_created_at_idx').on(table.createdAt),
  })
);

export const migrationRunsRelations = relations(migrationRuns, ({ one }) => ({
  tenant: one(tenants, {
    fields: [migrationRuns.tenantId],
    references: [tenants.id],
  }),
}));

export type MigrationRunRecord = typeof migrationRuns.$inferSelect;
export type NewMigrationRunRecord = typeof migrationRuns.$inferInsert;
