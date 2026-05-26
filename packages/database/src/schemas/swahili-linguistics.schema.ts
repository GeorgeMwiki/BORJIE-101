/**
 * Swahili Linguistics persistence (Wave 19H).
 *
 * Companion to Docs/DESIGN/SWAHILI_LINGUISTICS_SOTA_SPEC.md. Drizzle
 * types for the three tables created by migration
 * 0049_swahili_linguistics.sql:
 *
 *   - swahiliTerms            → bilingual glossary entries (mining-domain
 *                                seed lives in the TS package). Tenant-
 *                                scoped, RLS.
 *   - swahiliMorphologyCache  → memoised morphological analyses keyed
 *                                on the surface form. Tenant-scoped,
 *                                RLS.
 *   - swahiliDialectSignals   → per-user dialect-signal counters that
 *                                drive register adaptation. Tenant-
 *                                scoped, RLS.
 *
 * All three tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  real,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// swahili_terms — bilingual glossary entries
// ============================================================================

export const swahiliTerms = pgTable(
  'swahili_terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Surface form (canonical orthography). */
    term: text('term').notNull(),
    /** Lemma — uninflected root form. */
    lemma: text('lemma').notNull(),
    /** Bantu noun class 1-18 (null for non-nouns). */
    nounClass: integer('noun_class'),
    /** Plural class (null for singletons / mass nouns / non-nouns). */
    pluralClass: integer('plural_class'),
    /** formal | colloquial | sheng | coastal | bongo. */
    register: text('register').notNull().default('formal'),
    /** licensing | tax | royalty | environment | operations | trade | core | governance. */
    domain: text('domain').notNull().default('core'),
    /** English equivalent (single canonical). */
    enEquivalent: text('en_equivalent').notNull(),
    /** { sw: ..., en: ... } */
    definition: jsonb('definition').notNull().default({}),
    /** { url, title, accessedAt } */
    citation: jsonb('citation').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantDomainIdx: index('idx_swahili_terms_tenant_domain').on(
      t.tenantId,
      t.domain,
    ),
    tenantLemmaIdx: index('idx_swahili_terms_tenant_lemma').on(
      t.tenantId,
      t.lemma,
    ),
    tenantRegisterIdx: index('idx_swahili_terms_tenant_register').on(
      t.tenantId,
      t.register,
    ),
  }),
);

export type SwahiliTermRow = typeof swahiliTerms.$inferSelect;
export type NewSwahiliTermRow = typeof swahiliTerms.$inferInsert;

// ============================================================================
// swahili_morphology_cache — memoised morphological analyses
// ============================================================================

export const swahiliMorphologyCache = pgTable(
  'swahili_morphology_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Surface form analysed. */
    surfaceForm: text('surface_form').notNull(),
    /** Lemma — recovered uninflected stem. */
    lemma: text('lemma').notNull(),
    /** Array of { kind, value, slot } morpheme records. */
    morphemes: jsonb('morphemes').notNull().default([]),
    /** noun | verb | adj | adv | pron | num | conj | prep | particle. */
    pos: text('pos').notNull(),
    /** Per-POS features: { class?, tam?, subj?, obj?, fv?, ... }. */
    features: jsonb('features').notNull().default({}),
    /** Confidence in the analysis, 0..1. */
    confidence: real('confidence').notNull().default(1.0),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantLemmaIdx: index('idx_morphology_cache_tenant_lemma').on(
      t.tenantId,
      t.lemma,
    ),
    tenantPosIdx: index('idx_morphology_cache_tenant_pos').on(
      t.tenantId,
      t.pos,
    ),
  }),
);

export type SwahiliMorphologyCacheRow =
  typeof swahiliMorphologyCache.$inferSelect;
export type NewSwahiliMorphologyCacheRow =
  typeof swahiliMorphologyCache.$inferInsert;

// ============================================================================
// swahili_dialect_signals — per-user dialect-signal counters
// ============================================================================

export const swahiliDialectSignals = pgTable(
  'swahili_dialect_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    /** bongo | coastal | kenyan | sheng | standard. */
    dialect: text('dialect').notNull(),
    /** Number of utterances scored as this dialect for this user. */
    signalCount: integer('signal_count').notNull().default(0),
    lastObserved: timestamp('last_observed', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantUserIdx: index('idx_dialect_signals_tenant_user').on(
      t.tenantId,
      t.userId,
    ),
    tenantLastObservedIdx: index('idx_dialect_signals_tenant_last_observed').on(
      t.tenantId,
      t.lastObserved,
    ),
  }),
);

export type SwahiliDialectSignalRow =
  typeof swahiliDialectSignals.$inferSelect;
export type NewSwahiliDialectSignalRow =
  typeof swahiliDialectSignals.$inferInsert;
