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
} from 'drizzle-orm/pg-core';

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
    /** Slug of the source template used to compose the draft. */
    sourceTemplateSlug: text('source_template_slug').notNull(),
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
