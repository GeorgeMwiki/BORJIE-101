/**
 * Document Render Jobs Schema
 *
 * Tracks asynchronous template-based document render operations.
 * A render job captures:
 *  - which template was used (id + version)
 *  - which renderer engine rendered it (text, docxtemplater, react-pdf, typst)
 *  - the input data that was interpolated
 *  - the output artifact (linked via document_uploads once persisted)
 *  - status / errors / timings
 *
 * Nano Banana renderer jobs are NOT written here — see a separate
 * marketing-imagery audit table (out of scope for this pass).
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

export const rendererKindEnum = pgEnum('renderer_kind', [
  'text',
  'docxtemplater',
  'react-pdf',
  'typst',
]);

export const renderJobStatusEnum = pgEnum('render_job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const documentRenderJobs = pgTable(
  'document_render_jobs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    templateId: text('template_id').notNull(),
    templateVersion: text('template_version').notNull(),
    rendererKind: rendererKindEnum('renderer_kind').notNull(),

    status: renderJobStatusEnum('status').notNull().default('queued'),
    inputPayload: jsonb('input_payload').notNull().default({}),

    // Populated once the rendered artifact is stored.
    outputDocumentId: text('output_document_id'),
    outputMimeType: text('output_mime_type'),
    outputSizeBytes: integer('output_size_bytes'),
    pageCount: integer('page_count'),

    errorCode: text('error_code'),
    errorMessage: text('error_message'),

    // Linkage: which letter-request / lease / etc. caused the render.
    relatedEntityType: text('related_entity_type'),
    relatedEntityId: text('related_entity_id'),

    requestedBy: text('requested_by'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    tenantIdx: index('document_render_jobs_tenant_idx').on(table.tenantId),
    statusIdx: index('document_render_jobs_status_idx').on(table.status),
    templateIdx: index('document_render_jobs_template_idx').on(table.templateId),
    relatedIdx: index('document_render_jobs_related_idx').on(
      table.relatedEntityType,
      table.relatedEntityId
    ),
  })
);

export type DocumentRenderJob = typeof documentRenderJobs.$inferSelect;
export type NewDocumentRenderJob = typeof documentRenderJobs.$inferInsert;
