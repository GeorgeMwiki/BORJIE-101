/**
 * Interactive Reports Schema (NEW 17)
 *
 * Versioned interactive report artifacts — HTML bundles with embedded
 * media (photos/videos/charts) and clickable action plans.
 *
 * Additive: does not modify the existing reports.schema.ts. Linked by
 * reportInstanceId (FK by convention, enforced at service boundary to
 * avoid coupling to report instance table shape).
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

// ============================================================================
// Enums
// ============================================================================

export const interactiveReportRenderKindEnum = pgEnum(
  'interactive_report_render_kind',
  [
    'html_bundle',          // self-contained HTML with embedded/linked media
    'html_with_video',      // HTML bundle with embedded <video> element
    'html_with_charts',     // HTML bundle with client-rendered charts
    'print_pdf_fallback',   // server-rendered PDF of the HTML bundle
  ]
);

// ============================================================================
// Tables
// ============================================================================

export const interactiveReportVersions = pgTable(
  'interactive_report_versions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    // Link back to the parent report instance (enforced at service layer).
    reportInstanceId: text('report_instance_id').notNull(),

    // Monotonically increasing per reportInstanceId.
    version: integer('version').notNull().default(1),

    renderKind: interactiveReportRenderKindEnum('render_kind')
      .notNull()
      .default('html_bundle'),

    // Media references — list of { kind, storageKey, signedUrl, posterKey? }
    mediaReferences: jsonb('media_references').notNull().default([]),

    // Action plans — list of { id, title, description, action: { kind, payload }, status }
    actionPlans: jsonb('action_plans').notNull().default([]),

    // Signed URL to access the generated HTML bundle from storage.
    signedUrl: text('signed_url'),
    signedUrlKey: text('signed_url_key'), // storage object key
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // Hash of the bundle for integrity checks.
    contentHash: text('content_hash'),

    // Generation metadata.
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    generatedBy: text('generated_by'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdx: index('interactive_report_versions_tenant_idx').on(
      table.tenantId
    ),
    reportInstanceIdx: index('interactive_report_versions_report_instance_idx').on(
      table.reportInstanceId
    ),
    renderKindIdx: index('interactive_report_versions_render_kind_idx').on(
      table.renderKind
    ),
  })
);

// ============================================================================
// Acknowledgement audit (clicks on action-plan buttons)
// ============================================================================

export const interactiveReportActionAcks = pgTable(
  'interactive_report_action_acks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    interactiveReportVersionId: text('interactive_report_version_id')
      .notNull()
      .references(() => interactiveReportVersions.id, {
        onDelete: 'cascade',
      }),
    actionPlanId: text('action_plan_id').notNull(),

    // What happened: routed to work order, approval request, etc.
    resolution: text('resolution').notNull(),
    resolutionRefId: text('resolution_ref_id'),

    acknowledgedBy: text('acknowledged_by').notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb('metadata').default({}),
  },
  (table) => ({
    tenantIdx: index('interactive_report_action_acks_tenant_idx').on(
      table.tenantId
    ),
    versionIdx: index('interactive_report_action_acks_version_idx').on(
      table.interactiveReportVersionId
    ),
  })
);

// ============================================================================
// Relations
// ============================================================================

export const interactiveReportVersionsRelations = relations(
  interactiveReportVersions,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [interactiveReportVersions.tenantId],
      references: [tenants.id],
    }),
    acks: many(interactiveReportActionAcks),
  })
);

export const interactiveReportActionAcksRelations = relations(
  interactiveReportActionAcks,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [interactiveReportActionAcks.tenantId],
      references: [tenants.id],
    }),
    version: one(interactiveReportVersions, {
      fields: [interactiveReportActionAcks.interactiveReportVersionId],
      references: [interactiveReportVersions.id],
    }),
  })
);
