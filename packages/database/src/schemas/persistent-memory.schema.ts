/**
 * Persistent Memory + Skill Library persistence (Wave 18GG).
 *
 * Companion to docs/DESIGN/MEMORY_AMNESIA_PREVENTION_SOTA.md. Drizzle
 * types for the 4 tables created by migration
 * 0030_persistent_memory.sql:
 *
 *   - sessionMemory    → short-term tier; sliding-TTL summary of last
 *                        N turns + active decisions + pending
 *                        questions per (tenant, thread). Tenant-scoped,
 *                        RLS.
 *   - skills           → procedural memory tier (Voyager-style).
 *                        Versioned by (id, version). Tenant-scoped,
 *                        RLS.
 *   - pendingThreads   → anti-amnesia checkpoint table. One row per
 *                        unresolved decision / approval / data_request
 *                        / follow_up. Tenant-scoped, RLS.
 *   - threadSummaries  → MemGPT-style summarised turn-block records
 *                        for working-context budget compaction.
 *                        Tenant-scoped, RLS.
 *
 * All four tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern). All four are written exclusively through
 * the audit-hash chain (`@borjie/audit-hash-chain`).
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  numeric,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ============================================================================
// session_memory — short-term tier (sliding-TTL working snapshot)
// ============================================================================

export const sessionMemory = pgTable(
  'session_memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    userId: text('user_id').notNull(),
    threadId: uuid('thread_id').notNull(),
    summaryMd: text('summary_md').notNull(),
    /** Open decisions still in flight at last turn (typed as JSON list). */
    activeDecisions: jsonb('active_decisions').notNull().default([]),
    /** Questions Mr. Mwikila is still waiting for the user to answer. */
    pendingQuestions: jsonb('pending_questions').notNull().default([]),
    lastTurnAt: timestamp('last_turn_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Sliding-window expiry — refreshed at every turn. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    threadIdx: index('idx_session_thread').on(
      t.tenantId,
      t.threadId,
      t.lastTurnAt,
    ),
    userIdx: index('idx_session_user').on(
      t.tenantId,
      t.userId,
      t.lastTurnAt,
    ),
  }),
);

export type SessionMemoryRow = typeof sessionMemory.$inferSelect;
export type SessionMemoryInsert = typeof sessionMemory.$inferInsert;

// ============================================================================
// skills — procedural memory tier (Voyager-style skill library)
// ============================================================================

export const skills = pgTable(
  'skills',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    tenantId: text('tenant_id').notNull(),
    scopeId: text('scope_id').notNull(),
    /** Free-text intent — e.g. 'compose_tumemadini_return'. */
    intent: text('intent').notNull(),
    /** Precondition[] — preconditions that must hold before invocation. */
    preconditions: jsonb('preconditions').notNull().default([]),
    /** SkillStep[] — ordered sequence of tool_or_skill invocations. */
    steps: jsonb('steps').notNull().default([]),
    /** Postcondition[] — invariants that must hold after success. */
    postconditions: jsonb('postconditions').notNull().default([]),
    successRate: numeric('success_rate', { precision: 3, scale: 2 }),
    invocations: integer('invocations').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /** Skill IDs this skill composes from (skill-of-skills). */
    composedFromSkills: text('composed_from_skills')
      .array()
      .notNull()
      .default([]),
    /** observed | tested | canonical | deprecated */
    status: text('status').notNull().default('observed'),
    auditHash: text('audit_hash').notNull(),
    decayedAt: timestamp('decayed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.id, t.version] }),
    intentIdx: index('idx_skills_tenant_intent').on(
      t.tenantId,
      t.intent,
      t.status,
    ),
    lastUsedIdx: index('idx_skills_last_used').on(
      t.tenantId,
      t.lastUsedAt,
    ),
  }),
);

export type SkillRow = typeof skills.$inferSelect;
export type SkillInsert = typeof skills.$inferInsert;

// ============================================================================
// pending_threads — anti-amnesia checkpoint table
// ============================================================================

export const pendingThreads = pgTable(
  'pending_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    threadId: uuid('thread_id').notNull(),
    /** decision | approval | data_request | follow_up */
    pendingKind: text('pending_kind').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    auditHash: text('audit_hash').notNull().default(''),
  },
  (t) => ({
    userIdx: index('idx_pending_user').on(
      t.tenantId,
      t.userId,
      t.resolvedAt,
    ),
    threadIdx: index('idx_pending_thread').on(
      t.tenantId,
      t.threadId,
      t.createdAt,
    ),
  }),
);

export type PendingThreadRow = typeof pendingThreads.$inferSelect;
export type PendingThreadInsert = typeof pendingThreads.$inferInsert;

// ============================================================================
// thread_summaries — MemGPT-style summarised turn-block records
// ============================================================================

export const threadSummaries = pgTable(
  'thread_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    threadId: uuid('thread_id').notNull(),
    summaryMd: text('summary_md').notNull(),
    /**
     * Postgres `int4range` covering the turn sequence numbers this
     * summary represents. Stored as canonicalised string.
     */
    summarisedTurnRange: text('summarised_turn_range').notNull(),
    tokenCountOriginal: integer('token_count_original'),
    tokenCountSummary: integer('token_count_summary'),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    threadIdx: index('idx_thread_summary').on(t.threadId, t.generatedAt),
    tenantIdx: index('idx_thread_summary_tenant').on(
      t.tenantId,
      t.generatedAt,
    ),
  }),
);

export type ThreadSummaryRow = typeof threadSummaries.$inferSelect;
export type ThreadSummaryInsert = typeof threadSummaries.$inferInsert;
