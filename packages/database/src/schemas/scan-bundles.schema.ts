/**
 * Scan Bundles Schema (NEW 14)
 *
 * A scan bundle represents a multi-page document captured from the mobile
 * scanner. Pages flow through: captured → deskewed → ocr → assembled →
 * submitted (linked to a document_uploads row).
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
import { tenants } from './tenant.schema.js';

export const scanBundleStatusEnum = pgEnum('scan_bundle_status', [
  'draft',
  'processing',
  'ready',
  'submitted',
  'failed',
]);

export const scanBundles = pgTable(
  'scan_bundles',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    title: text('title'),
    purpose: text('purpose'),
    status: scanBundleStatusEnum('status').notNull().default('draft'),

    // Linked artifacts.
    assembledDocumentId: text('assembled_document_id'),
    pageCount: integer('page_count').notNull().default(0),

    // Audit trail of processing steps (deskew / OCR / assembly).
    processingLog: jsonb('processing_log').notNull().default([]),
    errorMessage: text('error_message'),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
  },
  (table) => ({
    tenantIdx: index('scan_bundles_tenant_idx').on(table.tenantId),
    statusIdx: index('scan_bundles_status_idx').on(table.status),
    createdByIdx: index('scan_bundles_created_by_idx').on(table.createdBy),
  })
);

export const scanBundlePages = pgTable(
  'scan_bundle_pages',
  {
    id: text('id').primaryKey(),
    bundleId: text('bundle_id')
      .notNull()
      .references(() => scanBundles.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),

    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    widthPx: integer('width_px'),
    heightPx: integer('height_px'),

    // Detected quad corners [{x,y},{x,y},{x,y},{x,y}]; null if none.
    quad: jsonb('quad'),
    ocrText: text('ocr_text'),
    ocrConfidence: integer('ocr_confidence'),

    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bundleIdx: index('scan_bundle_pages_bundle_idx').on(table.bundleId),
    tenantIdx: index('scan_bundle_pages_tenant_idx').on(table.tenantId),
  })
);

export type ScanBundle = typeof scanBundles.$inferSelect;
export type NewScanBundle = typeof scanBundles.$inferInsert;
export type ScanBundlePage = typeof scanBundlePages.$inferSelect;
export type NewScanBundlePage = typeof scanBundlePages.$inferInsert;
