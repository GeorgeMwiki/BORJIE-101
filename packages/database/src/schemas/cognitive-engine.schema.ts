/**
 * Cognitive Engine persistence (Wave 18T).
 *
 * Companion to docs/DESIGN/COGNITIVE_ENGINE_SPEC.md. Drizzle types for
 * the 3 tables created by migration 0024_cognitive_engine.sql:
 *
 *   - cognitiveTurns               → one row per kernel turn:
 *                                     reasoning trace, path, confidence,
 *                                     citations, uncertainty notes,
 *                                     audit hash.
 *   - ingestedAttachments          → owner-uploaded files parsed into
 *                                     a DataJoinRef (excel/csv/pdf/
 *                                     image/audio). 14-day default
 *                                     retention.
 *   - clarifyingQuestionHistory    → every question asked + the user's
 *                                     response. Enforces the
 *                                     3-question per-turn cap.
 *
 * All three tables are tenant-scoped via the canonical `app.tenant_id`
 * GUC RLS policy (migration 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';

// ============================================================================
// cognitive_turns — per-kernel-turn reasoning + outcome
// ============================================================================

export const cognitiveTurns = pgTable(
  'cognitive_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull(),
    utterance: text('utterance').notNull(),
    /** Full ReasoningTrace (see @borjie/cognitive-engine types). */
    reasoningTrace: jsonb('reasoning_trace').notNull(),
    /** asked_for_clarification | asked_for_data | composed_output | refused_low_confidence. */
    path: text('path').notNull(),
    /** Reference to the composed artifact, if any. */
    artifactRef: jsonb('artifact_ref'),
    /** high | medium | low | refused. */
    confidence: text('confidence').notNull(),
    /** SpanCitation[] used in the output. */
    citations: jsonb('citations').notNull().default([]),
    uncertaintyNotes: jsonb('uncertainty_notes'),
    costUsdCents: integer('cost_usd_cents'),
    durationMs: integer('duration_ms'),
    auditHash: text('audit_hash').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionRecentIdx: index('cognitive_turns_session_recent_idx').on(
      t.sessionId,
      t.occurredAt,
    ),
    tenantRecentIdx: index('cognitive_turns_tenant_recent_idx').on(
      t.tenantId,
      t.occurredAt,
    ),
    pathIdx: index('cognitive_turns_path_idx').on(t.path, t.occurredAt),
    confidenceIdx: index('cognitive_turns_confidence_idx').on(
      t.confidence,
      t.occurredAt,
    ),
    auditHashIdx: index('cognitive_turns_audit_hash_idx').on(t.auditHash),
  }),
);

export type CognitiveTurnRow = typeof cognitiveTurns.$inferSelect;
export type CognitiveTurnInsert = typeof cognitiveTurns.$inferInsert;

// ============================================================================
// ingested_attachments — adaptive-ingest payloads stamped as DataJoinRef
// ============================================================================

export const ingestedAttachments = pgTable(
  'ingested_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** excel | csv | pdf | image | audio. */
    kind: text('kind').notNull(),
    storageKey: text('storage_key').notNull(),
    originalFilename: text('original_filename'),
    /** ColumnSpec[] for tabular kinds; null otherwise. */
    parsedColumns: jsonb('parsed_columns'),
    parsedRowsCount: integer('parsed_rows_count'),
    piiRedactions: jsonb('pii_redactions').notNull().default([]),
    dataJoinRef: jsonb('data_join_ref').notNull(),
    relevanceToIntent: numeric('relevance_to_intent', {
      precision: 3,
      scale: 2,
    }),
    retentionUntil: timestamp('retention_until', { withTimezone: true }).notNull(),
    auditHash: text('audit_hash').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionIdx: index('ingested_attachments_session_idx').on(
      t.sessionId,
      t.ingestedAt,
    ),
    tenantKindIdx: index('ingested_attachments_tenant_kind_idx').on(
      t.tenantId,
      t.kind,
      t.ingestedAt,
    ),
    retentionIdx: index('ingested_attachments_retention_idx').on(
      t.retentionUntil,
    ),
    auditHashIdx: index('ingested_attachments_audit_hash_idx').on(t.auditHash),
  }),
);

export type IngestedAttachmentRow = typeof ingestedAttachments.$inferSelect;
export type IngestedAttachmentInsert = typeof ingestedAttachments.$inferInsert;

// ============================================================================
// clarifying_question_history — every question asked + the response
// ============================================================================

export const clarifyingQuestionHistory = pgTable(
  'clarifying_question_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    turnId: uuid('turn_id')
      .notNull()
      .references(() => cognitiveTurns.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    possibleAnswers: jsonb('possible_answers'),
    whyNeeded: text('why_needed').notNull(),
    userResponse: text('user_response'),
    askedAt: timestamp('asked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => ({
    turnIdx: index('clarifying_question_history_turn_idx').on(t.turnId, t.askedAt),
    pendingIdx: index('clarifying_question_history_tenant_pending_idx').on(
      t.tenantId,
      t.askedAt,
    ),
  }),
);

export type ClarifyingQuestionRow =
  typeof clarifyingQuestionHistory.$inferSelect;
export type ClarifyingQuestionInsert =
  typeof clarifyingQuestionHistory.$inferInsert;
