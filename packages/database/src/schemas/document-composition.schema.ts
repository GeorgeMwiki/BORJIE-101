/**
 * Document Composition persistence (Wave 17D).
 *
 * Companion to docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md. Drizzle types
 * for the 4 tables created by migration 0019_document_composition.sql:
 *
 *   - documentRecipes        → versioned recipe registry (global).
 *                               Closed set of 11 DocumentClass values.
 *   - documentArtifacts      → produced artefacts with checksum +
 *                               span_citations + audit_hash. Tier-2
 *                               approval state tracked here.
 *   - docEvolutionProposals  → owner-facing improvement queue.
 *   - docFeedbackEvents      → acceptance/revision/rejection signals.
 *
 * documentRecipes is global product config — no tenant_id, RLS disabled.
 * The other three are tenant-scoped.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  smallint,
  boolean,
  jsonb,
  uuid,
  primaryKey,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';

// ============================================================================
// document_recipes — versioned recipe registry (GLOBAL)
// ============================================================================

export const documentRecipes = pgTable(
  'document_recipes',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    /** draft | shadow | live | locked | deprecated. */
    status: text('status').notNull(),
    /** daily_briefing | board_report | investor_briefing |
     *  tumemadini_return | nemc_filing | buyer_kyb_pack | sop |
     *  financial_model | contract | geological_report |
     *  marketplace_listing. */
    class: text('class').notNull(),
    composeFnRef: text('compose_fn_ref').notNull(),
    requiredInputs: jsonb('required_inputs').notNull().default([]),
    requiredCitations: jsonb('required_citations').notNull().default([]),
    /** Subset of: pdf | docx | pptx | xlsx | md | html. */
    outputFormats: text('output_formats').array().notNull().default([]),
    /** 0 | 1 | 2 — see AUTHORITY TIERS in the spec. */
    authorityTier: smallint('authority_tier').notNull(),
    brand: text('brand').notNull().default('borjie'),
    /** Tier-2 docs always true; Tier-1 may be false for auto-publish. */
    approvalRequired: boolean('approval_required').notNull().default(true),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    promotedBy: text('promoted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.id, t.version] }),
    statusIdx: index('document_recipes_status_idx').on(t.status),
    classIdx: index('document_recipes_class_idx').on(t.class),
    promotedByIdx: index('document_recipes_promoted_by_idx').on(t.promotedBy),
  }),
);

// ============================================================================
// document_artifacts — produced artefacts with audit chain + approval
// ============================================================================

export const documentArtifacts = pgTable(
  'document_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recipeId: text('recipe_id').notNull(),
    recipeVersion: integer('recipe_version').notNull(),
    /** pdf | docx | pptx | xlsx | md | html. */
    format: text('format').notNull(),
    /** Supabase Storage key, bucket-scoped per document class. */
    storageKey: text('storage_key').notNull(),
    /** SHA-256 of the rendered file. */
    checksum: text('checksum').notNull(),
    /** SpanCitation[] embedded into the artefact. */
    spanCitations: jsonb('span_citations').notNull().default([]),
    /** Tied into the tenant's audit-hash chain. */
    auditHash: text('audit_hash').notNull(),
    /** pending | approved | rejected | auto_published. */
    approvalState: text('approval_state').notNull().default('pending'),
    approvedBy: text('approved_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    recipeFk: foreignKey({
      columns: [t.recipeId, t.recipeVersion],
      foreignColumns: [documentRecipes.id, documentRecipes.version],
      name: 'document_artifacts_recipe_fk',
    }),
    recipeIdx: index('document_artifacts_recipe_idx').on(
      t.recipeId,
      t.recipeVersion,
    ),
    tenantGeneratedIdx: index('document_artifacts_tenant_generated_idx').on(
      t.tenantId,
      t.generatedAt,
    ),
    approvalIdx: index('document_artifacts_approval_idx').on(
      t.approvalState,
      t.generatedAt,
    ),
    auditHashIdx: index('document_artifacts_audit_hash_idx').on(t.auditHash),
    approvedByIdx: index('document_artifacts_approved_by_idx').on(t.approvedBy),
  }),
);

// ============================================================================
// doc_evolution_proposals — owner-facing improvement queue
// ============================================================================

export const docEvolutionProposals = pgTable(
  'doc_evolution_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recipeId: text('recipe_id').notNull(),
    currentVersion: integer('current_version').notNull(),
    proposedVersion: integer('proposed_version').notNull(),
    /** Section-level diff payload. */
    proposedDiff: jsonb('proposed_diff').notNull(),
    /** Feedback signals that triggered this proposal. */
    signals: jsonb('signals').notNull().default({}),
    /** Corpus citation IDs justifying the change. */
    citations: text('citations').array().notNull().default([]),
    /** pending | approved | rejected | expired. */
    status: text('status').notNull().default('pending'),
    proposedAt: timestamp('proposed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewerReason: text('reviewer_reason'),
    approvalAuditHash: text('approval_audit_hash'),
  },
  (t) => ({
    statusRecipeIdx: index('doc_evolution_proposals_status_recipe_idx').on(
      t.status,
      t.recipeId,
    ),
    tenantStatusIdx: index('doc_evolution_proposals_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.proposedAt,
    ),
    reviewedByIdx: index('doc_evolution_proposals_reviewed_by_idx').on(t.reviewedBy),
  }),
);

// ============================================================================
// doc_feedback_events — signals consumed by doc-evolution-worker
// ============================================================================

export const docFeedbackEvents = pgTable(
  'doc_feedback_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => documentArtifacts.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** accepted | revised | rejected | regulator_flag |
     *  owner_rewrite | time_to_approve | submit_failure. */
    feedbackKind: text('feedback_kind').notNull(),
    /** 'sections.assays' etc. NULL for whole-doc events. */
    sectionPath: text('section_path'),
    detail: jsonb('detail').notNull().default({}),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    artifactKindIdx: index('doc_feedback_events_artifact_kind_idx').on(
      t.artifactId,
      t.feedbackKind,
    ),
    tenantRecordedIdx: index('doc_feedback_events_tenant_recorded_idx').on(
      t.tenantId,
      t.recordedAt,
    ),
    kindRecordedIdx: index('doc_feedback_events_kind_recorded_idx').on(
      t.feedbackKind,
      t.recordedAt,
    ),
  }),
);

export type DocumentRecipe = typeof documentRecipes.$inferSelect;
export type NewDocumentRecipe = typeof documentRecipes.$inferInsert;
export type DocumentArtifact = typeof documentArtifacts.$inferSelect;
export type NewDocumentArtifact = typeof documentArtifacts.$inferInsert;
export type DocEvolutionProposal = typeof docEvolutionProposals.$inferSelect;
export type NewDocEvolutionProposal = typeof docEvolutionProposals.$inferInsert;
export type DocFeedbackEvent = typeof docFeedbackEvents.$inferSelect;
export type NewDocFeedbackEvent = typeof docFeedbackEvents.$inferInsert;
