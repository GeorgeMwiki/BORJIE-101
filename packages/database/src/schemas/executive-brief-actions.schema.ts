/**
 * executive_brief_actions — Piece E action queue.
 *
 * The "approved actions" queue surfaced from an executive_brief.
 * RecommendedActions enter as `status='pending'`, are flipped to
 * `status='approved'` once a human (or auto-approve policy) signs off,
 * then the Piece E worker drains rows where
 * `status='approved' AND executed_at IS NULL` and dispatches them to
 * the junior executor.
 *
 * Lifecycle:
 *   pending → approved → executed | failed
 *   pending → rejected (terminal)
 *
 * RLS-FORCED in migration 0013 under the platform-standard
 * tenant_isolation policy.
 */

import {
  pgTable,
  text,
  smallint,
  jsonb,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────
// executive_brief_actions
// ─────────────────────────────────────────────────────────────────────

export const executiveBriefActions = pgTable(
  'executive_brief_actions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    briefId: text('brief_id'),
    /**
     * Junior to dispatch — must match a key in
     * `packages/ai-copilot/src/juniors/executor-registry`.
     */
    juniorName: text('junior_name').notNull(),
    intent: text('intent').notNull(),
    payloadJsonb: jsonb('payload_jsonb').notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('pending'),
    attempts: smallint('attempts').notNull().default(0),
    /** Populated on `failed` rows so the worker doesn't retry forever. */
    errorText: text('error_text'),
    /** Populated on `executed` rows — junior output, evidence ids, conf. */
    resultJsonb: jsonb('result_jsonb'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('idx_executive_brief_actions_tenant_status').on(
      t.tenantId,
      t.status,
      t.executedAt,
    ),
    briefIdx: index('idx_executive_brief_actions_brief').on(t.briefId),
    statusCheck: check(
      'executive_brief_actions_status_chk',
      sql`${t.status} IN ('pending','approved','executed','failed','rejected')`,
    ),
    attemptsCheck: check(
      'executive_brief_actions_attempts_chk',
      sql`${t.attempts} >= 0 AND ${t.attempts} <= 10`,
    ),
  }),
);

export type ExecutiveBriefActionRow = typeof executiveBriefActions.$inferSelect;
export type ExecutiveBriefActionInsert = typeof executiveBriefActions.$inferInsert;
