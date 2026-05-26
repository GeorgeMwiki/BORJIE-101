/**
 * Language-SOTA persistence (Wave 19G).
 *
 * Companion to Docs/DESIGN/LANGUAGE_VOICE_SOTA_SPEC.md. Drizzle types for
 * the three tables created by migration 0048_language_sota.sql:
 *
 *   - languageUtterances        → captured Mr. Mwikila utterances across
 *                                  voice / chat / sms / whatsapp channels
 *                                  with phonemes, prosody, and code-switch
 *                                  segments. Consent-gated, hash-chained.
 *   - languageProviderQuality   → periodic (provider, language) WER + PER +
 *                                  MOS samples driving the routing decision.
 *   - languageUserProfile       → per-user preferred / secondary language,
 *                                  dialect tags, pronunciation profile.
 *
 * All three tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  integer,
  real,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ============================================================================
// language_utterances — one row per captured utterance
// ============================================================================

export const languageUtterances = pgTable(
  'language_utterances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    /** voice | chat | sms | whatsapp */
    channel: text('channel').notNull(),
    /** Caller-declared language tag (en | sw | sheng | unknown). */
    sourceLang: text('source_lang').notNull(),
    /** Detector verdict — may differ from source_lang. */
    detectedLang: text('detected_lang').notNull(),
    text: text('text').notNull(),
    /** Phoneme sequence — array of { ipa, start_ms, end_ms, gop }. */
    phonemes: jsonb('phonemes').notNull().default([]),
    /** Prosody envelope — f0_contour + stress_bins + intonation_shape. */
    prosody: jsonb('prosody').notNull().default({}),
    /** Token-level code-switching segments. */
    codeswitchSegments: jsonb('codeswitch_segments').notNull().default([]),
    /** Detector confidence in [0, 1]. */
    confidence: real('confidence').notNull(),
    /** Provider that produced the STT transcript. */
    provider: text('provider'),
    /** Consent state captured at write time. */
    consentState: text('consent_state').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
    prevHash: text('prev_hash').notNull(),
  },
  (table) => ({
    tenantRecordedIdx: index('idx_language_utterances_tenant_recorded').on(
      table.tenantId,
      table.recordedAt,
    ),
    tenantUserRecordedIdx: index(
      'idx_language_utterances_tenant_user_recorded',
    ).on(table.tenantId, table.userId, table.recordedAt),
    tenantChannelIdx: index('idx_language_utterances_tenant_channel').on(
      table.tenantId,
      table.channel,
      table.recordedAt,
    ),
    tenantLangIdx: index('idx_language_utterances_tenant_lang').on(
      table.tenantId,
      table.detectedLang,
      table.recordedAt,
    ),
    auditHashIdx: index('idx_language_utterances_audit_hash').on(
      table.auditHash,
    ),
  }),
);

export type LanguageUtterance = typeof languageUtterances.$inferSelect;
export type NewLanguageUtterance = typeof languageUtterances.$inferInsert;

// ============================================================================
// language_provider_quality — periodic (provider, language) samples
// ============================================================================

export const languageProviderQuality = pgTable(
  'language_provider_quality',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    provider: text('provider').notNull(),
    lang: text('lang').notNull(),
    /** Word Error Rate in [0, 1]. */
    wer: real('wer').notNull(),
    /** Phoneme Error Rate in [0, 1]. */
    per: real('per').notNull(),
    /** Mean Opinion Score in [1, 5]. */
    mos: real('mos').notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    sampleN: integer('sample_n').notNull(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    tenantProviderLangIdx: index(
      'idx_lpq_tenant_provider_lang_measured',
    ).on(table.tenantId, table.provider, table.lang, table.measuredAt),
    tenantLangIdx: index('idx_lpq_tenant_lang_measured').on(
      table.tenantId,
      table.lang,
      table.measuredAt,
    ),
  }),
);

export type LanguageProviderQuality =
  typeof languageProviderQuality.$inferSelect;
export type NewLanguageProviderQuality =
  typeof languageProviderQuality.$inferInsert;

// ============================================================================
// language_user_profile — per-user language preference + pronunciation
// ============================================================================

export const languageUserProfile = pgTable(
  'language_user_profile',
  {
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    preferredLang: text('preferred_lang').notNull().default('en'),
    // UNIV-4: column default = TZ launch beachhead (sw); future jurisdictions write their own secondary language code from their jurisdiction profile's installed language packs. See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
    secondaryLang: text('secondary_lang').notNull().default('sw'),
    /** Per-phoneme baseline — { [ipa]: { gop_mean, gop_std, samples } }. */
    pronunciationProfile: jsonb('pronunciation_profile').notNull().default({}),
    /** Dialect annotations (e.g. ['sw-TZ-coastal', 'sheng-mwanza']). */
    dialectTags: text('dialect_tags').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.userId] }),
    tenantPreferredIdx: index(
      'idx_language_user_profile_tenant_preferred',
    ).on(table.tenantId, table.preferredLang),
  }),
);

export type LanguageUserProfile = typeof languageUserProfile.$inferSelect;
export type NewLanguageUserProfile = typeof languageUserProfile.$inferInsert;
