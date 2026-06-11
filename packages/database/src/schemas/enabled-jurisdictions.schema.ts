/**
 * Enabled-jurisdictions schema — the generative launch-market spine.
 *
 * Platform-GLOBAL reference data (no tenant_id, same posture as
 * `discovered_jurisdictions`): which ISO countries users may select at signup,
 * the per-country region overlay (VAT/timezone/locale/phone the compliance
 * plugin does not carry), and provenance for admin-uploaded jurisdiction
 * corpora. Seeded with TZ only — adding a market is a governed row insert (the
 * `mwikila.jurisdiction.promote` four-eye flow), never a code deploy.
 *
 * Migration: packages/database/src/migrations/0337_enabled_jurisdictions.sql
 */

import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

/** The launch-market gate, as data. One row = one selectable country. */
export const enabledCountries = pgTable(
  'enabled_countries',
  {
    code: text('code').primaryKey(), // ISO-3166-1 alpha-2, UPPERCASE
    name: text('name').notNull(),
    currencyCode: text('currency_code'),
    enabledAt: timestamp('enabled_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    enabledByAdminId: text('enabled_by_admin_id'),
    learnedFromCorpus: boolean('learned_from_corpus').notNull().default(false),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    activeIdx: index('enabled_countries_active_idx').on(t.code),
  }),
);

/** Per-country overlay for fields the compliance plugin does not carry. */
export const regionOverlays = pgTable('region_overlays', {
  countryCode: text('country_code').primaryKey(),
  timezone: text('timezone'),
  locale: text('locale'),
  phoneDialingCode: text('phone_dialing_code'),
  phoneRegex: text('phone_regex'),
  phonePlaceholder: text('phone_placeholder'),
  vatRate: numeric('vat_rate'),
  taxAuthority: text('tax_authority'),
  taxpayerIdLabel: text('taxpayer_id_label'),
  extras: jsonb('extras').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Provenance for admin-uploaded jurisdiction compliance corpora. */
export const complianceDocUploads = pgTable(
  'compliance_doc_uploads',
  {
    id: text('id').primaryKey(),
    countryCode: text('country_code').notNull(),
    docType: text('doc_type'),
    uploadedByAdminId: text('uploaded_by_admin_id'),
    filePath: text('file_path'),
    extractionStatus: text('extraction_status').notNull().default('pending'),
    corpusChunkCount: integer('corpus_chunk_count').notNull().default(0),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    countryIdx: index('compliance_doc_uploads_country_idx').on(
      t.countryCode,
      t.uploadedAt,
    ),
  }),
);

export type EnabledCountryRow = typeof enabledCountries.$inferSelect;
export type RegionOverlayRow = typeof regionOverlays.$inferSelect;
export type ComplianceDocUploadRow = typeof complianceDocUploads.$inferSelect;
