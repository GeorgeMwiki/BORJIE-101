/**
 * Document Drafts Registry — drafts of legal / commercial / regulatory
 * documents (contracts, RFPs, RFP responses, letters, notices, memos)
 * that the Borjie brain composes on behalf of the owner / manager.
 *
 * Backed by migration `0084_drafts_registry.sql` (FORCE RLS on
 * `app.current_tenant_id`). Tenant-scoped; revisions chain through
 * `parent_draft_id`, so the full evolution of a contract can be
 * replayed end-to-end.
 *
 * Companion to:
 *   - services/api-gateway/src/services/document-drafter/
 *   - services/api-gateway/src/routes/mining/draft.hono.ts
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  index,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { provenanceColumn } from '../helpers/provenance-column.js';

// ============================================================================
// document_drafts — persisted draft documents
// ============================================================================

export const documentDrafts = pgTable(
  'document_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /** User who initiated the draft. */
    createdByUserId: text('created_by_user_id').notNull(),
    /** contract|rfp|rfp_response|letter|notice|memo. */
    kind: text('kind').notNull(),
    /** drafting|reviewing|finalized|sent|archived. */
    status: text('status').notNull().default('drafting'),
    /** Swahili-first title (CLAUDE.md "Swahili-first" hard rule). */
    titleSw: text('title_sw').notNull(),
    /** Optional English mirror of the title. */
    titleEn: text('title_en'),
    /** Jurisdiction (TZ|KE|UG|...). Defaults from tenant config. */
    jurisdiction: text('jurisdiction'),
    /** sw|en|bilingual. */
    language: text('language').notNull().default('sw'),
    /** Rendered document body as Markdown. */
    contentMd: text('content_md').notNull(),
    /**
     * Slug of the source template used to compose the draft. May be
     * NULL when the draft was composed free-form (migration 0100).
     */
    sourceTemplateSlug: text('source_template_slug'),
    /** Owner's natural-language ask (free-form drafts). */
    intent: text('intent'),
    /** Brain-inferred document kind (free-form drafts). */
    inferredKind: text('inferred_kind'),
    /** Most recent revision number in the child draft_revisions table. */
    currentRevisionNo: integer('current_revision_no').notNull().default(1),
    /** Document classification: public|internal|confidential. */
    classification: text('classification').notNull().default('internal'),
    /** Cached blob urls by render format (e.g. {"pdf":"s3://..."}). */
    renderedBlobUrls: jsonb('rendered_blob_urls').notNull().default('{}'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** 1-based revision counter; bumped on every /revise. */
    revisionCount: integer('revision_count').notNull().default(1),
    /** Timestamp of the last /revise call (or first draft if unrevised). */
    lastRevisedAt: timestamp('last_revised_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Self-reference: the draft id this revision was based on. */
    parentDraftId: text('parent_draft_id'),
    /** Hash-chained audit-trail link. */
    hashChainId: text('hash_chain_id'),
    /** Chat-as-OS bidirectional parity. See migration 0101. */
    provenance: provenanceColumn(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantCreatorStatusCreatedIdx: index(
      'idx_document_drafts_tenant_creator_status_created',
    ).on(t.tenantId, t.createdByUserId, t.status, t.createdAt),
    tenantKindStatusIdx: index('idx_document_drafts_tenant_kind_status').on(
      t.tenantId,
      t.kind,
      t.status,
    ),
    parentDraftIdx: index('idx_document_drafts_parent').on(t.parentDraftId),
  }),
);

export type DocumentDraft = typeof documentDrafts.$inferSelect;
export type NewDocumentDraft = typeof documentDrafts.$inferInsert;

// ============================================================================
// Enum constants — exported for routers & services that need the
// canonical lists (e.g. zod enums, JSON-schema for the brain tools).
// ============================================================================

export const DRAFT_KINDS = [
  'contract',
  'rfp',
  'rfp_response',
  'letter',
  'notice',
  'memo',
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const DRAFT_STATUSES = [
  'drafting',
  'reviewing',
  'finalized',
  'sent',
  'archived',
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const DRAFT_LANGUAGES = ['sw', 'en', 'bilingual'] as const;
export type DraftLanguage = (typeof DRAFT_LANGUAGES)[number];

export const DRAFT_CLASSIFICATIONS = [
  'public',
  'internal',
  'confidential',
] as const;
export type DraftClassification = (typeof DRAFT_CLASSIFICATIONS)[number];

// ============================================================================
// draft_revisions — every save spawns a new revision row (migration 0100).
// ============================================================================

export const draftRevisions = pgTable(
  'draft_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    draftId: uuid('draft_id').notNull(),
    revisionNo: integer('revision_no').notNull(),
    contentMd: text('content_md').notNull(),
    contentFormat: text('content_format').notNull().default('markdown'),
    renderedBlobUrl: text('rendered_blob_url'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    citations: jsonb('citations').notNull().default('[]'),
    auditHash: text('audit_hash'),
    /** Chat-as-OS bidirectional parity. See migration 0101. */
    provenance: provenanceColumn(),
  },
  (t) => ({
    tenantDraftRevIdx: index('idx_draft_revisions_tenant_draft_rev').on(
      t.tenantId,
      t.draftId,
      t.revisionNo,
    ),
    tenantCreatedIdx: index('idx_draft_revisions_tenant_created').on(
      t.tenantId,
      t.createdAt,
    ),
    uniqueDraftRev: uniqueIndex('draft_revisions_draft_rev_uq').on(
      t.draftId,
      t.revisionNo,
    ),
  }),
);

export type DraftRevision = typeof draftRevisions.$inferSelect;
export type NewDraftRevision = typeof draftRevisions.$inferInsert;

export const DRAFT_REVISION_FORMATS = ['markdown', 'html', 'plain'] as const;
export type DraftRevisionFormat = (typeof DRAFT_REVISION_FORMATS)[number];

// ============================================================================
// draft_citations — sources the brain pulled per revision (migration 0100).
// ============================================================================

export const draftCitations = pgTable(
  'draft_citations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    draftId: uuid('draft_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceRef: text('source_ref').notNull(),
    snippetUsed: text('snippet_used'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantRevisionIdx: index('idx_draft_citations_tenant_revision').on(
      t.tenantId,
      t.revisionId,
    ),
    tenantDraftIdx: index('idx_draft_citations_tenant_draft').on(
      t.tenantId,
      t.draftId,
    ),
  }),
);

export type DraftCitation = typeof draftCitations.$inferSelect;
export type NewDraftCitation = typeof draftCitations.$inferInsert;

export const DRAFT_CITATION_SOURCE_KINDS = [
  'corpus_chunk',
  'owner_doc',
  'external_benchmark',
  'peer_cohort',
  'manual',
] as const;
export type DraftCitationSourceKind =
  (typeof DRAFT_CITATION_SOURCE_KINDS)[number];
