/**
 * Owner-style profile schema (Wave OWNER-STYLE / gap-8).
 *
 * Mr. Mwikila adapts HOW it speaks to each mining owner — verbosity, detail,
 * language (EN/SW), formality, posture — learned online via a Bayesian
 * feedback loop (decay 0.98 + reaction-boost). One row per tenant captures the
 * current headline of each dimension as a queryable numeric score, the
 * language lean, an aggregate confidence, a feedback count, and the full
 * Dirichlet posterior in `profile_json` so the rich model round-trips.
 *
 * Ported from the BossNyumba owner_style_profiles table, retargeted
 * real-estate → mining. The dimensions are communication-style axes (domain
 * neutral); the brain-side EN+SW lexicons carry mining-owner idioms.
 *
 * Companion files:
 *   - packages/database/src/migrations/0282_owner_style_profiles.sql
 *     (+ down/0282_down_owner_style_profiles.sql)
 *   - packages/database/src/repositories/owner-style.repository.ts
 *     (createPgOwnerStyleProfileStore — satisfies the OwnerStyleProfileStore
 *      port in @borjie/ai-copilot)
 *   - packages/ai-copilot/src/personas/owner-style/
 *
 * Tenant scope (CLAUDE.md hard rule): FORCE RLS on the canonical
 * `app.current_tenant_id` GUC (the GUC the api-gateway databaseMiddleware
 * binds). `tenant_id` is TEXT (no uuid cast), matching the Borjie convention
 * across the mining-domain tables (see site-damage-settlement.schema.ts).
 *
 * Currency-neutral / language: scores are dimensionless [0,1]; the language
 * column stores a learned LEAN only. The ABSOLUTE EN/SW toggle remains owned
 * by user settings and wins at render time — this profile never overrides it.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  numeric,
  integer,
  index,
  unique,
} from 'drizzle-orm/pg-core';

/** Verbosity headline values (mirrored as a CHECK in mig 0282). */
export const OWNER_STYLE_VERBOSITIES = ['terse', 'balanced', 'verbose'] as const;
export type OwnerStyleVerbosity = (typeof OWNER_STYLE_VERBOSITIES)[number];

/** Detail headline values. */
export const OWNER_STYLE_DETAILS = ['low', 'medium', 'high'] as const;
export type OwnerStyleDetail = (typeof OWNER_STYLE_DETAILS)[number];

/** Language lean values. */
export const OWNER_STYLE_LANGUAGES = [
  'en',
  'en_leaning_bilingual',
  'sw_leaning_bilingual',
  'sw',
] as const;
export type OwnerStyleLanguage = (typeof OWNER_STYLE_LANGUAGES)[number];

/** Formality headline values. */
export const OWNER_STYLE_FORMALITIES = ['formal', 'neutral', 'casual'] as const;
export type OwnerStyleFormality = (typeof OWNER_STYLE_FORMALITIES)[number];

/** Posture (decision + risk) headline values. */
export const OWNER_STYLE_POSTURES = ['cautious', 'balanced', 'bold'] as const;
export type OwnerStylePosture = (typeof OWNER_STYLE_POSTURES)[number];

export const ownerStyleProfiles = pgTable(
  'owner_style_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Tenant-scoped: one profile row per tenant (UNIQUE). TEXT, no uuid cast. */
    tenantId: text('tenant_id').notNull(),

    /** Headline category per dimension. */
    verbosity: text('verbosity').notNull().default('balanced'),
    detail: text('detail').notNull().default('medium'),
    formality: text('formality').notNull().default('neutral'),
    posture: text('posture').notNull().default('balanced'),
    languagePreference: text('language_preference').notNull().default('en'),

    /**
     * Per-dimension confidence projected to [0,1] (share of probability mass
     * at the headline category). Stored so dashboards can sort/threshold
     * without unpacking profile_json.
     */
    verbosityScore: numeric('verbosity_score', { precision: 5, scale: 4 })
      .notNull()
      .default('0'),
    detailScore: numeric('detail_score', { precision: 5, scale: 4 })
      .notNull()
      .default('0'),
    formalityScore: numeric('formality_score', { precision: 5, scale: 4 })
      .notNull()
      .default('0'),
    postureScore: numeric('posture_score', { precision: 5, scale: 4 })
      .notNull()
      .default('0'),

    /** Aggregate confidence across all dimensions [0,1]. */
    confidence: numeric('confidence', { precision: 5, scale: 4 })
      .notNull()
      .default('0'),

    /** Total observations folded into this profile. */
    feedbackCount: integer('feedback_count').notNull().default(0),

    /** The feedback-signal kind that last moved the profile, if any. */
    updatedBySignal: text('updated_by_signal'),

    /**
     * The full OwnerStyleProfile (Dirichlet weights per dimension) so the rich
     * Bayesian model round-trips. Typed columns above are a denormalised
     * projection for queryability.
     */
    profileJson: jsonb('profile_json').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantUq: unique('owner_style_profiles_tenant_uq').on(t.tenantId),
    tenantUpdatedIdx: index('owner_style_profiles_tenant_updated').on(
      t.tenantId,
      t.updatedAt,
    ),
  }),
);

export type OwnerStyleProfileRow = typeof ownerStyleProfiles.$inferSelect;
export type NewOwnerStyleProfileRow = typeof ownerStyleProfiles.$inferInsert;
