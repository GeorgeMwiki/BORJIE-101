/**
 * Translation SOTA persistence (Wave 19I).
 *
 * Companion to Docs/DESIGN/TRANSLATION_SOTA_SPEC.md. Drizzle types for
 * the 3 tables created by migration 0050_translation_sota.sql:
 *
 *   - translationRuns                  → one row per translation call
 *                                        (provider invocation). Stores
 *                                        source/target text, provider
 *                                        used, glossary terms
 *                                        substituted, code-switch
 *                                        segments, BLEU / chrF /
 *                                        terminology-adherence,
 *                                        latency, cost. Hash-chained.
 *   - translationGlossaryOverrides     → per-tenant term overrides on
 *                                        top of bundled mining + Wave-
 *                                        19H domain glossaries. UNIQUE
 *                                        (tenant_id, src_term, src_lang,
 *                                        target_lang, register).
 *   - translationEvals                 → per-(run, judge) eval score.
 *                                        judge in {bleu, chrf, comet,
 *                                        terminology-adherence, human}.
 *
 * All three are tenant-scoped via the canonical `app.tenant_id` GUC
 * RLS policy (migration 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  real,
  integer,
  jsonb,
  uuid,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

// ============================================================================
// translation_runs — one row per provider call
// ============================================================================

export const translationRuns = pgTable(
  'translation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Source language code — `sw` or `en`. */
    sourceLang: text('source_lang').notNull(),
    /** Target language code — `sw` or `en`. */
    targetLang: text('target_lang').notNull(),
    sourceText: text('source_text').notNull(),
    targetText: text('target_text').notNull(),
    /** Provider used: claude-opus-4-7 | gemini-2-5-pro | nllb-200. */
    provider: text('provider').notNull(),
    /** GlossaryEntry refs the lock substituted in this run. */
    glossaryTermsUsed: jsonb('glossary_terms_used').notNull().default([]),
    /** Code-switch segments with language-ID tags. */
    codeSwitchSegments: jsonb('code_switch_segments').notNull().default([]),
    /** BLEU 0-100; null until eval ran. */
    bleu: real('bleu'),
    /** chrF 0-1; null until eval ran. */
    chrf: real('chrf'),
    /** Mr. Mwikila glossary-survival % (0-1); null until eval ran. */
    terminologyAdherence: real('terminology_adherence'),
    latencyMs: integer('latency_ms').notNull().default(0),
    costUsdCents: integer('cost_usd_cents').notNull().default(0),
    auditHash: text('audit_hash').notNull(),
    prevHash: text('prev_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantRecentIdx: index('idx_translation_runs_tenant_recent').on(
      t.tenantId,
      t.createdAt,
    ),
    providerIdx: index('idx_translation_runs_provider').on(
      t.tenantId,
      t.provider,
      t.createdAt,
    ),
    langPairIdx: index('idx_translation_runs_lang_pair').on(
      t.tenantId,
      t.sourceLang,
      t.targetLang,
      t.createdAt,
    ),
    auditHashIdx: index('idx_translation_runs_audit_hash').on(t.auditHash),
  }),
);

export type TranslationRunRow = typeof translationRuns.$inferSelect;
export type TranslationRunInsert = typeof translationRuns.$inferInsert;

// ============================================================================
// translation_glossary_overrides — per-tenant term overrides
// ============================================================================

export const translationGlossaryOverrides = pgTable(
  'translation_glossary_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    srcTerm: text('src_term').notNull(),
    srcLang: text('src_lang').notNull(),
    targetTerm: text('target_term').notNull(),
    targetLang: text('target_lang').notNull(),
    /** mining | regulatory | financial | safety | general. */
    domain: text('domain').notNull().default('general'),
    /** formal | neutral | casual. */
    register: text('register').notNull().default('neutral'),
    /** Optional source URL where the term came from. */
    sourceUrl: text('source_url'),
    auditHash: text('audit_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('idx_translation_glossary_overrides_tenant').on(
      t.tenantId,
      t.domain,
    ),
    termIdx: index('idx_translation_glossary_overrides_term').on(
      t.tenantId,
      t.srcLang,
      t.srcTerm,
    ),
    auditHashIdx: index('idx_translation_glossary_overrides_audit_hash').on(
      t.auditHash,
    ),
    uniqueOverride: unique('translation_glossary_overrides_unique').on(
      t.tenantId,
      t.srcTerm,
      t.srcLang,
      t.targetLang,
      t.register,
    ),
  }),
);

export type TranslationGlossaryOverrideRow =
  typeof translationGlossaryOverrides.$inferSelect;
export type TranslationGlossaryOverrideInsert =
  typeof translationGlossaryOverrides.$inferInsert;

// ============================================================================
// translation_evals — per-(run, judge) eval score
// ============================================================================

export const translationEvals = pgTable(
  'translation_evals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => translationRuns.id, { onDelete: 'cascade' }),
    /** bleu | chrf | comet | terminology-adherence | human. */
    judge: text('judge').notNull(),
    /** Judge-specific score, range depends on judge. */
    score: real('score').notNull(),
    /** Judge-specific rubric snapshot for forensic replay. */
    rubric: jsonb('rubric').notNull().default({}),
    judgedAt: timestamp('judged_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    runIdx: index('idx_translation_evals_run').on(t.runId, t.judgedAt),
    tenantRecentIdx: index('idx_translation_evals_tenant_recent').on(
      t.tenantId,
      t.judgedAt,
    ),
    judgeIdx: index('idx_translation_evals_judge').on(
      t.tenantId,
      t.judge,
      t.judgedAt,
    ),
    auditHashIdx: index('idx_translation_evals_audit_hash').on(t.auditHash),
  }),
);

export type TranslationEvalRow = typeof translationEvals.$inferSelect;
export type TranslationEvalInsert = typeof translationEvals.$inferInsert;
