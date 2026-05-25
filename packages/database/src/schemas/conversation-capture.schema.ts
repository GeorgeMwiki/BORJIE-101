/**
 * conversation_capture (migration 0229) — Piece L brain-tab loop.
 *
 * One row per captured user/assistant exchange that the brain decided
 * to act on. Entities are resolved to canonical IDs; intent is
 * classified; confidence is scored. The dispatcher reads this table
 * to choose which module tabs to update.
 *
 * Tenant-scoped via RLS. Append-only by application convention
 * (the audit chain row witnesses each insert).
 */

import {
  pgTable,
  text,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const conversationCapture = pgTable(
  'conversation_capture',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Optional thread join (NULL for one-shot captures outside a thread). */
    threadId: text('thread_id'),
    /**
     * Soft pointer to the message that triggered capture. Piece F's
     * messages table is on `claude/piece-f`; can also point at
     * thread_events.id for compatibility until then.
     */
    messageId: text('message_id'),
    /** Persona id that produced the assistant reply. */
    personaId: text('persona_id').notNull(),
    /** Actor (user) who sent the originating message. */
    userId: text('user_id'),
    /** PII-scrubbed user utterance. */
    userText: text('user_text').notNull(),
    /** Verbatim assistant reply text. */
    assistantText: text('assistant_text').notNull(),
    /** Brain decision kind: 'answer' | 'softened' (refusals skip capture). */
    decisionKind: text('decision_kind').notNull(),
    /**
     * Resolved canonical entities — JSONB ARRAY of:
     *   {type, canonical_id, raw_value, confidence, source}.
     */
    entities: jsonb('entities').notNull().default([]),
    /**
     * Intent classifier output: one of
     *   request_info | propose_action | file_event | ask_for_help | ambiguous.
     */
    intent: text('intent').notNull(),
    /** Intent classification confidence in [0, 1]. */
    intentConfidence: doublePrecision('intent_confidence').notNull().default(0),
    /**
     * Overall capture confidence = min(resolver, intent, persona_trust,
     * tenant_trust). Below router threshold → emit proactive nudge.
     */
    captureConfidence: doublePrecision('capture_confidence')
      .notNull()
      .default(0),
    /** Persona trust (T1=1.0 ... T5=0.40). */
    personaTrust: doublePrecision('persona_trust').notNull().default(0.7),
    /** Tenant trust (0.5..1.0). */
    tenantTrust: doublePrecision('tenant_trust').notNull().default(0.8),
    /** Free-form attributes (session id, surface id, cohort signal, etc.). */
    attributes: jsonb('attributes').notNull().default({}),
    /** SHA-256 of (userText || '\n' || assistantText) — dedup key. */
    exchangeHash: text('exchange_hash').notNull(),
    /** Cumulative latency budget: classifier_ms + dispatch_ms. */
    latencyMs: integer('latency_ms').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('conversation_capture_tenant_created_idx').on(
      t.tenantId,
      t.createdAt,
    ),
    tenantIntentIdx: index('conversation_capture_tenant_intent_idx').on(
      t.tenantId,
      t.intent,
    ),
    threadIdx: index('conversation_capture_thread_idx').on(t.threadId),
    messageIdx: index('conversation_capture_message_idx').on(t.messageId),
    hashIdx: index('conversation_capture_hash_idx').on(
      t.tenantId,
      t.exchangeHash,
    ),
  }),
);

export type ConversationCaptureRow = typeof conversationCapture.$inferSelect;
export type ConversationCaptureInsert =
  typeof conversationCapture.$inferInsert;
