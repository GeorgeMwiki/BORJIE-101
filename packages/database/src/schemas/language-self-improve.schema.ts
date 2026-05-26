/**
 * Language Self-Improvement Loop persistence (Wave 19K).
 *
 * Companion to Docs/DESIGN/LANGUAGE_SELF_IMPROVE_SPEC.md. Drizzle types
 * for the 4 tables created by migration 0052_language_self_improve.sql:
 *
 *   - languageTrainingPairs   → captured (source, target) utterance
 *                                pair + 4-axis scores (WER, PER, grammar,
 *                                terminology). PII redacted before
 *                                persistence. FOUNDER_LOCKED §1.3 + §1.4
 *                                govern consent_state.
 *   - languageAdapters        → per-(tenant, lang) adapter. Kind in
 *                                (lora, rag-prefix, full-ft). Lifecycle:
 *                                training → staged → live → rolled-back
 *                                | deprecated.
 *   - languageEvalRuns        → gauntlet eval run. 4 mechanical axes +
 *                                nullable MOS + PromotionDecider
 *                                decision in (promote, rollback, no-op).
 *   - languageGauntletEntries → per-tenant additions to the base
 *                                200-utterance extended gauntlet.
 *
 * All four tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern). Consumed by `@borjie/language-self-improve`.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  real,
  integer,
  boolean,
  index,
  unique,
} from 'drizzle-orm/pg-core';

// ============================================================================
// language_training_pairs — captured (source, target) + 4-axis scores
// ============================================================================

export const languageTrainingPairs = pgTable(
  'language_training_pairs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    sourceText: text('source_text').notNull(),
    targetText: text('target_text').notNull(),
    lang: text('lang').notNull(),
    utteranceId: text('utterance_id'),
    /** 4-axis scores {wer, per, grammar, terminology, aggregate, recipient_consent}. */
    scores: jsonb('scores').notNull().default({}),
    included: boolean('included').notNull().default(true),
    /** Required IFF included = false. */
    exclusionReason: text('exclusion_reason'),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
    prevHash: text('prev_hash').notNull(),
  },
  (table) => ({
    tenantIdx: index('idx_language_training_pairs_tenant').on(
      table.tenantId,
      table.lang,
      table.recordedAt,
    ),
    includedIdx: index('idx_language_training_pairs_included').on(
      table.tenantId,
      table.lang,
      table.included,
      table.recordedAt,
    ),
  }),
);

// ============================================================================
// language_adapters — per-(tenant, lang) adapter
// ============================================================================

export const languageAdapters = pgTable(
  'language_adapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    lang: text('lang').notNull(),
    version: text('version').notNull(),
    /** lora | rag-prefix | full-ft */
    adapterKind: text('adapter_kind').notNull(),
    baseModel: text('base_model').notNull(),
    trainingPairCount: integer('training_pair_count').notNull().default(0),
    /** training | staged | live | rolled-back | deprecated */
    status: text('status').notNull().default('training'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    tenantIdx: index('idx_language_adapters_tenant').on(
      table.tenantId,
      table.lang,
      table.createdAt,
    ),
    statusIdx: index('idx_language_adapters_status').on(
      table.tenantId,
      table.lang,
      table.status,
      table.createdAt,
    ),
    uniqueVersion: unique('language_adapters_unique_version').on(
      table.tenantId,
      table.lang,
      table.version,
    ),
  }),
);

// ============================================================================
// language_eval_runs — gauntlet eval run
// ============================================================================

export const languageEvalRuns = pgTable(
  'language_eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    adapterId: uuid('adapter_id'),
    gauntletVersion: text('gauntlet_version').notNull(),
    wer: real('wer').notNull().default(0),
    per: real('per').notNull().default(0),
    grammarScore: real('grammar_score').notNull().default(0),
    terminologyScore: real('terminology_score').notNull().default(0),
    /** Mean Opinion Score [1, 5]; null until human raters fill it. */
    mos: real('mos'),
    /** promote | rollback | no-op */
    decision: text('decision').notNull().default('no-op'),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    tenantIdx: index('idx_language_eval_runs_tenant').on(
      table.tenantId,
      table.ranAt,
    ),
    adapterIdx: index('idx_language_eval_runs_adapter').on(
      table.adapterId,
      table.ranAt,
    ),
    decisionIdx: index('idx_language_eval_runs_decision').on(
      table.tenantId,
      table.decision,
      table.ranAt,
    ),
  }),
);

// ============================================================================
// language_gauntlet_entries — per-tenant additions to base set
// ============================================================================

export const languageGauntletEntries = pgTable(
  'language_gauntlet_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    lang: text('lang').notNull(),
    prompt: text('prompt').notNull(),
    expectedText: text('expected_text').notNull(),
    expectedIntent: text('expected_intent'),
    domain: text('domain'),
    /** bongo | coast | lake | sheng | other */
    dialect: text('dialect'),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    tenantIdx: index('idx_language_gauntlet_entries_tenant').on(
      table.tenantId,
      table.lang,
    ),
    dialectIdx: index('idx_language_gauntlet_entries_dialect').on(
      table.tenantId,
      table.lang,
      table.dialect,
    ),
    uniquePrompt: unique('language_gauntlet_entries_unique_prompt').on(
      table.tenantId,
      table.lang,
      table.prompt,
    ),
  }),
);

// ============================================================================
// Inferred types — public surface
// ============================================================================

export type LanguageTrainingPairRow = typeof languageTrainingPairs.$inferSelect;
export type NewLanguageTrainingPairRow =
  typeof languageTrainingPairs.$inferInsert;

export type LanguageAdapterRow = typeof languageAdapters.$inferSelect;
export type NewLanguageAdapterRow = typeof languageAdapters.$inferInsert;

export type LanguageEvalRunRow = typeof languageEvalRuns.$inferSelect;
export type NewLanguageEvalRunRow = typeof languageEvalRuns.$inferInsert;

export type LanguageGauntletEntryRow =
  typeof languageGauntletEntries.$inferSelect;
export type NewLanguageGauntletEntryRow =
  typeof languageGauntletEntries.$inferInsert;
