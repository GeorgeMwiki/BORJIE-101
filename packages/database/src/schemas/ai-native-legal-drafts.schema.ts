/**
 * legal_drafts (migration 0289) — Agent PhL legal-drafter durable store.
 *
 * One row per AI-native first-draft mining-contract document (licence-suspension
 * notice, off-take addendum, demand letter, royalty-increase notice, ...). The
 * body is composed by a REAL Anthropic LLM call grounded in the jurisdiction's
 * statutory clause/notice requirements. EVERY draft is queued for human review
 * by default; a licence-suspension notice is NEVER auto-sendable regardless of
 * policy — enforced both in code (FORBIDDEN_AUTO_SEND) AND in the DB via the
 * `legal_drafts_suspension_must_review` CHECK constraint.
 *
 * Tenant scope (CLAUDE.md hard rule — mirrors voice_turns / migration 0289):
 * tenant_id is TEXT and FK→tenants; the durable table FORCE-enables RLS on the
 * canonical `app.current_tenant_id` GUC. The Drizzle repo also filters every
 * read by tenantId for defence-in-depth.
 *
 * Currency neutrality (CLAUDE.md hard rule): no money column here — any monetary
 * fact lives inside the free-form `context` jsonb exactly as the LLM was handed
 * it (minor-units + currency), never a typed money column or currency literal.
 *
 * The jsonb columns are typed (`$type`) so the Drizzle repo round-trips them
 * without a cast; the `LegalDraftCitation` shape is declared locally to keep
 * `@borjie/database` free of an `@borjie/ai-copilot` import.
 *
 * Companion to:
 *   - packages/database/src/migrations/0289_ai_native_legal_drafts.sql
 *   - services/api-gateway/src/composition/ai-native/drizzle-repos.ts
 */

import {
  pgTable,
  text,
  boolean,
  doublePrecision,
  jsonb,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';

/** Mirrors `LegalDocumentKind` from legal-drafter/types.ts (CHECK in mig 0289). */
export const LEGAL_DOCUMENT_KINDS = [
  'notice_to_cease',
  'offtake_addendum',
  'demand_letter',
  'licence_suspension_notice',
  'renewal_offer',
  'royalty_increase_notice',
  'cure_or_cease',
  'offboarding_statement',
  'other',
] as const;
export type LegalDraftDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

/** Mirrors the `autonomyDecision` union from legal-drafter/types.ts. */
export const LEGAL_DRAFT_AUTONOMY_DECISIONS = [
  'queued_for_review',
  'auto_send_allowed',
  'auto_send_forbidden',
] as const;
export type LegalDraftAutonomyDecision =
  (typeof LEGAL_DRAFT_AUTONOMY_DECISIONS)[number];

/** PhL `Citation` shape — declared locally (see file header). */
export interface LegalDraftCitation {
  readonly kind: string;
  readonly ref: string;
  readonly note?: string;
}

export const legalDrafts = pgTable(
  'legal_drafts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentKind: text('document_kind')
      .$type<LegalDraftDocumentKind>()
      .notNull(),
    countryCode: text('country_code').notNull(),
    jurisdictionMetadata: jsonb('jurisdiction_metadata')
      .notNull()
      .$type<Readonly<Record<string, unknown>>>()
      .default({}),
    subjectCustomerId: text('subject_customer_id'),
    subjectOfftakeId: text('subject_offtake_id'),
    subjectSiteId: text('subject_site_id'),
    subjectPitId: text('subject_pit_id'),
    languageCode: text('language_code'),
    draftTitle: text('draft_title').notNull(),
    draftBody: text('draft_body').notNull(),
    requiredClauses: jsonb('required_clauses')
      .notNull()
      .$type<ReadonlyArray<string>>()
      .default([]),
    legalCitations: jsonb('legal_citations')
      .notNull()
      .$type<ReadonlyArray<string>>()
      .default([]),
    reviewFlags: jsonb('review_flags')
      .notNull()
      .$type<ReadonlyArray<string>>()
      .default([]),
    needsHumanReview: boolean('needs_human_review').notNull().default(true),
    status: text('status').notNull().default('draft'),
    autonomyDecision: text('autonomy_decision')
      .$type<LegalDraftAutonomyDecision>()
      .notNull(),
    modelVersion: text('model_version').notNull(),
    promptHash: text('prompt_hash').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    context: jsonb('context')
      .notNull()
      .$type<Readonly<Record<string, unknown>>>()
      .default({}),
    citations: jsonb('citations')
      .notNull()
      .$type<ReadonlyArray<LegalDraftCitation>>()
      .default([]),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('idx_legal_drafts_tenant_created').on(
      t.tenantId,
      t.createdAt.desc(),
    ),
    tenantKindCreatedIdx: index('idx_legal_drafts_tenant_kind_created').on(
      t.tenantId,
      t.documentKind,
      t.createdAt.desc(),
    ),
    suspensionMustReviewCheck: check(
      'legal_drafts_suspension_must_review',
      sql`${t.documentKind} <> 'licence_suspension_notice' OR ${t.needsHumanReview} = TRUE`,
    ),
    confidenceCheck: check(
      'legal_drafts_confidence_chk',
      sql`${t.confidence} BETWEEN 0 AND 1`,
    ),
  }),
);

export type LegalDraftRecord = typeof legalDrafts.$inferSelect;
export type NewLegalDraftRecord = typeof legalDrafts.$inferInsert;
