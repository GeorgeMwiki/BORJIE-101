/**
 * Compliance Exports — regulator manifest table.
 *
 * Companion to:
 *   - packages/database/src/migrations/0122_compliance_exports.sql
 *   - services/api-gateway/src/routes/compliance.router.ts
 *   - services/reports/src/compliance/compliance-export-service.ts
 *
 * One row per regulator-facing export run. Four export types backed:
 *   tz_tra       Tanzania Revenue Authority (royalties + duties + VAT)
 *   ke_dpa       Kenya Data Protection Act controller register
 *   ke_kra       Kenya Revenue Authority quarterly remittance
 *   tz_land_act  Tanzania Land Act stewardship report
 *
 * Lifecycle:
 *   scheduled → generating → ready → downloaded
 *                                 ↘ archived
 *                                 ↘ failed
 *
 * Tenant-isolated via `app.current_tenant_id` RLS policy (FORCE).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  index,
} from 'drizzle-orm/pg-core';

// ----------------------------------------------------------------------------
// Enums — surfaced as TS string-literal unions because the SQL migration
// enforces them as CHECK constraints rather than native PG enums (keeps
// migration forward-only without ALTER TYPE gymnastics).
// ----------------------------------------------------------------------------

export const COMPLIANCE_EXPORT_TYPES = [
  'tz_tra',
  'ke_dpa',
  'ke_kra',
  'tz_land_act',
] as const;
export type ComplianceExportType = (typeof COMPLIANCE_EXPORT_TYPES)[number];

export const COMPLIANCE_EXPORT_FORMATS = ['csv', 'json', 'xml', 'pdf'] as const;
export type ComplianceExportFormat =
  (typeof COMPLIANCE_EXPORT_FORMATS)[number];

export const COMPLIANCE_EXPORT_STATUSES = [
  'scheduled',
  'generating',
  'ready',
  'downloaded',
  'failed',
  'archived',
] as const;
export type ComplianceExportStatus =
  (typeof COMPLIANCE_EXPORT_STATUSES)[number];

// ----------------------------------------------------------------------------
// Table
// ----------------------------------------------------------------------------

export const complianceExports = pgTable(
  'compliance_exports',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** tz_tra | ke_dpa | ke_kra | tz_land_act. */
    exportType: text('export_type').notNull(),
    /** csv | json | xml | pdf. */
    format: text('format').notNull(),
    /** scheduled | generating | ready | downloaded | failed | archived. */
    status: text('status').notNull().default('scheduled'),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    downloadedAt: timestamp('downloaded_at', { withTimezone: true }),
    storageKey: text('storage_key'),
    fileSizeBytes: integer('file_size_bytes'),
    fileChecksum: text('file_checksum'),
    /** Regulator-supplied parameters (e.g. TIN, mining licence number). */
    regulatorContext: jsonb('regulator_context').notNull().default({}),
    errorMessage: text('error_message'),
    requestedBy: text('requested_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('compliance_exports_tenant_idx').on(
      t.tenantId,
      t.createdAt,
    ),
    typeIdx: index('compliance_exports_type_idx').on(
      t.tenantId,
      t.exportType,
      t.createdAt,
    ),
    statusIdx: index('compliance_exports_status_idx').on(t.tenantId, t.status),
    periodIdx: index('compliance_exports_period_idx').on(
      t.tenantId,
      t.periodStart,
      t.periodEnd,
    ),
  }),
);

// ----------------------------------------------------------------------------
// Type re-exports
// ----------------------------------------------------------------------------

export type ComplianceExportRow = typeof complianceExports.$inferSelect;
export type NewComplianceExportRow = typeof complianceExports.$inferInsert;
