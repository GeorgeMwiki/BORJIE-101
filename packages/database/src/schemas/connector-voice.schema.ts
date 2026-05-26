/**
 * Twilio Voice connector persistence — Wave OMNI-P1.
 *
 * Companion to migration 0046_omni_p1.sql. Drizzle types for the
 * `voice_calls` table.
 *
 * Distinct from `services/wave-resilience-manager`'s SMS notifier:
 * shares `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` root env but
 * operates under a dedicated sub-account SID
 * (`TWILIO_VOICE_SUBACCOUNT_SID`) so voice TPS and billing are
 * partitioned. `twilio_account` here is the sub-account SID.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const voiceCalls = pgTable(
  'voice_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Twilio sub-account SID. */
    twilioAccount: text('twilio_account').notNull(),
    callSid: text('call_sid').notNull(),
    /** `inbound` | `outbound-api` | `outbound-dial` | `outbound`. */
    direction: text('direction').notNull(),
    /** Salted-hash redacted at ingest. */
    fromPhone: text('from_phone').notNull(),
    toPhone: text('to_phone').notNull(),
    durationS: integer('duration_s'),
    recordingUri: text('recording_uri'),
    transcriptText: text('transcript_text'),
    raw: jsonb('raw').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantIngestedIdx: index('idx_voice_calls_tenant_ingested').on(
      t.tenantId,
      t.ingestedAt,
    ),
    uq: uniqueIndex('voice_calls_uq').on(
      t.tenantId,
      t.twilioAccount,
      t.callSid,
    ),
  }),
);

export type VoiceCall = typeof voiceCalls.$inferSelect;
export type NewVoiceCall = typeof voiceCalls.$inferInsert;
