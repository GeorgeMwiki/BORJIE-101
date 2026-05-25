/**
 * voice_turns (migration 0110) — append-only log of voice-mediated
 * conversational turns owned by Agent PhL (voice-first tenant/owner agent).
 *
 * Each row records the STT transcript, LLM-detected language (any
 * ISO-639-1/-2 — never hardcoded to en/sw), the brain's response text,
 * any tool calls executed, and the TTS audio reference. `degraded_mode`
 * is TRUE when STT or TTS adapters returned VOICE_NOT_CONFIGURED so the
 * turn still logs for analytics even when audio I/O is unavailable.
 */

import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  jsonb,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';

export const voiceTurns = pgTable(
  'voice_turns',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    customerId: text('customer_id'),
    turnIndex: integer('turn_index').notNull(),
    detectedLanguage: text('detected_language'),
    inputAudioRef: text('input_audio_ref'),
    inputTranscript: text('input_transcript'),
    sttConfidence: doublePrecision('stt_confidence'),
    responseText: text('response_text'),
    responseAudioRef: text('response_audio_ref'),
    toolCalls: jsonb('tool_calls').notNull().default([]),
    degradedMode: boolean('degraded_mode').notNull().default(false),
    modelVersion: text('model_version'),
    promptHash: text('prompt_hash'),
    latencyMs: integer('latency_ms'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionIdx: index('idx_voice_turns_session').on(
      t.tenantId,
      t.sessionId,
      t.turnIndex,
    ),
    customerIdx: index('idx_voice_turns_customer').on(
      t.tenantId,
      t.customerId,
      t.createdAt.desc(),
    ),
    turnIndexCheck: check(
      'voice_turns_turn_index_chk',
      sql`${t.turnIndex} >= 0`,
    ),
    sttConfidenceCheck: check(
      'voice_turns_stt_confidence_chk',
      sql`${t.sttConfidence} IS NULL OR (${t.sttConfidence} BETWEEN 0 AND 1)`,
    ),
    latencyCheck: check(
      'voice_turns_latency_chk',
      sql`${t.latencyMs} IS NULL OR ${t.latencyMs} >= 0`,
    ),
  }),
);

export type VoiceTurnRecord = typeof voiceTurns.$inferSelect;
export type NewVoiceTurnRecord = typeof voiceTurns.$inferInsert;
