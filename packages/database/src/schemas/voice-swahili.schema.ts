/**
 * Voice channel + Swahili gauntlet persistence (Wave 19F).
 *
 * Companion to Docs/DESIGN/VOICE_GEMINI_LIVE_SWAHILI_SPEC.md. Drizzle types
 * for the two tables created by migration 0034_voice_swahili.sql:
 *
 *   - voiceSessions            → one row per caller session across
 *                                whatsapp / sms / app / pstn channels. Tracks
 *                                provider, language, latency, demotion
 *                                history. Tenant-scoped, RLS.
 *   - swahiliGauntletResults   → one row per utterance per gauntlet run.
 *                                Stores WER + MOS for the drift dashboard.
 *                                Tenant-scoped, RLS.
 *
 * Both tables use the canonical `app.tenant_id` GUC RLS policy (migration
 * 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  integer,
  numeric,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// voice_sessions — one row per live caller session
// ============================================================================

export const voiceSessions = pgTable(
  'voice_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** E.164 phone for WhatsApp/SMS/PSTN; user_id for in-app callers. */
    callerId: text('caller_id').notNull(),
    /** whatsapp | sms | app | pstn */
    channel: text('channel').notNull(),
    /** gemini-live | gpt-realtime-2 | whisper-local | anthropic-eleven */
    provider: text('provider').notNull(),
    /** Language tag (sw | sw-TZ | en-KE | sheng | …). */
    // UNIV-4: column default = TZ launch beachhead (Swahili); future jurisdictions write their own value (e.g. 'en-GB', 'pt-BR'). See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
    language: text('language').notNull().default('sw'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    turnCount: integer('turn_count').notNull().default(0),
    voiceToVoiceP50Ms: integer('voice_to_voice_p50_ms'),
    voiceToVoiceP95Ms: integer('voice_to_voice_p95_ms'),
    /** Array of `{ from, to, reason, at }` records — append-only audit trail. */
    demotionHistory: jsonb('demotion_history').notNull().default([]),
    /** Reference to the transcript object store (e.g. s3://…). */
    transcriptArchiveRef: text('transcript_archive_ref'),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    tenantStartedIdx: index('idx_voice_sessions_tenant_started').on(
      table.tenantId,
      table.startedAt,
    ),
    tenantProviderIdx: index('idx_voice_sessions_tenant_provider_started').on(
      table.tenantId,
      table.provider,
      table.startedAt,
    ),
    callerIdx: index('idx_voice_sessions_caller').on(
      table.tenantId,
      table.callerId,
      table.startedAt,
    ),
  }),
);

export type VoiceSession = typeof voiceSessions.$inferSelect;
export type NewVoiceSession = typeof voiceSessions.$inferInsert;

// ============================================================================
// swahili_gauntlet_results — one row per gauntlet utterance
// ============================================================================

export const swahiliGauntletResults = pgTable(
  'swahili_gauntlet_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Groups all 50 utterances of one run. */
    runId: uuid('run_id').notNull(),
    provider: text('provider').notNull(),
    modelVersion: text('model_version').notNull(),
    /** FK to the `test-utterances.ts` set (e.g. 'reg-001'). */
    utteranceId: text('utterance_id').notNull(),
    referenceTranscript: text('reference_transcript').notNull(),
    hypothesisTranscript: text('hypothesis_transcript').notNull(),
    /** WER as a fraction; numeric(6,4). */
    wer: numeric('wer', { precision: 6, scale: 4 }).notNull(),
    /** MOS (1.00 .. 5.00); nullable until human raters fill in. */
    mos: numeric('mos', { precision: 3, scale: 2 }),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    tenantRunIdx: index('idx_sgr_tenant_run').on(table.tenantId, table.runId),
    tenantProviderCreatedIdx: index('idx_sgr_tenant_provider_created').on(
      table.tenantId,
      table.provider,
      table.createdAt,
    ),
    tenantUtteranceCreatedIdx: index('idx_sgr_tenant_utterance_created').on(
      table.tenantId,
      table.utteranceId,
      table.createdAt,
    ),
  }),
);

export type SwahiliGauntletResult = typeof swahiliGauntletResults.$inferSelect;
export type NewSwahiliGauntletResult = typeof swahiliGauntletResults.$inferInsert;
