/**
 * document_entities + document_obligations (migration 0288) — Agent PhL
 * doc-intelligence durable store.
 *
 * `document_entities` holds one row per extracted entity (party, date, amount,
 * jurisdiction, ...); `document_obligations` holds one row per extracted
 * obligation (who must do what by when, with risk flags). Both are produced by a
 * REAL Anthropic extraction over an uploaded mining document, and both cite a
 * `span_start`/`span_end` character range into the canonical document text so
 * the UI can highlight the exact source line. Language is LLM-detected per row
 * (any ISO-639-1/-2 — never hardcoded en/sw).
 *
 * `embedding_ref` is an opaque handle into the pgvector semantic-memory layer
 * (written via the memory port elsewhere) — kept vector-dialect-agnostic here.
 *
 * Tenant scope (CLAUDE.md hard rule — mirrors voice_turns / migration 0288):
 * tenant_id is TEXT and FK→tenants; both durable tables FORCE-enable RLS on the
 * canonical `app.current_tenant_id` GUC. The Drizzle repo also filters every
 * read by tenantId for defence-in-depth.
 *
 * The jsonb `normalized_form` / `risk_flags` columns are typed (`$type`) so the
 * Drizzle repo round-trips them without a cast.
 *
 * Companion to:
 *   - packages/database/src/migrations/0288_ai_native_document_intelligence.sql
 *   - services/api-gateway/src/composition/ai-native/drizzle-repos.ts
 */

import {
  pgTable,
  text,
  integer,
  doublePrecision,
  jsonb,
  date,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';

/** Mirrors `EntityKind` from doc-intelligence/types.ts (CHECK in mig 0288). */
export const DOCUMENT_ENTITY_KINDS = [
  'party',
  'property',
  'unit',
  'date',
  'amount',
  'currency',
  'jurisdiction',
  'contract_kind',
  'reference',
  'other',
] as const;
export type DocumentEntityKind = (typeof DOCUMENT_ENTITY_KINDS)[number];

// ── document_entities ────────────────────────────────────────────────────────

export const documentEntities = pgTable(
  'document_entities',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: text('document_id').notNull(),
    entityKind: text('entity_kind').$type<DocumentEntityKind>().notNull(),
    entityValue: text('entity_value').notNull(),
    entityRaw: text('entity_raw'),
    normalizedForm: jsonb('normalized_form')
      .notNull()
      .$type<Readonly<Record<string, unknown>>>()
      .default({}),
    languageCode: text('language_code'),
    spanStart: integer('span_start'),
    spanEnd: integer('span_end'),
    confidence: doublePrecision('confidence'),
    embeddingRef: text('embedding_ref'),
    modelVersion: text('model_version').notNull(),
    promptHash: text('prompt_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantDocumentIdx: index('idx_document_entities_tenant_document').on(
      t.tenantId,
      t.documentId,
    ),
    tenantKindIdx: index('idx_document_entities_tenant_kind').on(
      t.tenantId,
      t.entityKind,
      t.createdAt.desc(),
    ),
    confidenceCheck: check(
      'document_entities_confidence_chk',
      sql`${t.confidence} IS NULL OR (${t.confidence} BETWEEN 0 AND 1)`,
    ),
  }),
);

export type DocumentEntityRecord = typeof documentEntities.$inferSelect;
export type NewDocumentEntityRecord = typeof documentEntities.$inferInsert;

// ── document_obligations ─────────────────────────────────────────────────────

export const documentObligations = pgTable(
  'document_obligations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: text('document_id').notNull(),
    obligor: text('obligor').notNull(),
    obligee: text('obligee'),
    actionSummary: text('action_summary').notNull(),
    dueDate: date('due_date'),
    recurrence: text('recurrence'),
    consequenceIfMissed: text('consequence_if_missed'),
    riskFlags: jsonb('risk_flags')
      .notNull()
      .$type<ReadonlyArray<string>>()
      .default([]),
    languageCode: text('language_code'),
    spanStart: integer('span_start'),
    spanEnd: integer('span_end'),
    confidence: doublePrecision('confidence'),
    modelVersion: text('model_version').notNull(),
    promptHash: text('prompt_hash').notNull(),
    explanation: text('explanation'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantDocumentIdx: index('idx_document_obligations_tenant_document').on(
      t.tenantId,
      t.documentId,
    ),
    tenantDueIdx: index('idx_document_obligations_tenant_due').on(
      t.tenantId,
      t.dueDate,
    ),
    confidenceCheck: check(
      'document_obligations_confidence_chk',
      sql`${t.confidence} IS NULL OR (${t.confidence} BETWEEN 0 AND 1)`,
    ),
  }),
);

export type DocumentObligationRecord =
  typeof documentObligations.$inferSelect;
export type NewDocumentObligationRecord =
  typeof documentObligations.$inferInsert;
