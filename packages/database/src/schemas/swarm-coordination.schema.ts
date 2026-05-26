/**
 * Swarm Coordination persistence (Wave 18HH).
 *
 * Companion to Docs/DESIGN/AGENT_SWARM_COORDINATION_SOTA.md. Drizzle
 * types for the 4 tables created by migration 0060_swarm_coordination.sql
 * (renumbered from 0030 to resolve collision with 0030_persistent_memory.sql;
 * alphabetic precedence keeps persistent_memory at slot 0030):
 *
 *   - activeAgents             → real-time registry of running agents.
 *                                Heartbeat + status; stale rows cleared
 *                                by the swarm-coordination cron. Tenant-
 *                                scoped, RLS.
 *   - agentMessages            → A2A push channel. Direct / broadcast /
 *                                subject-scoped. Tenant-scoped, RLS.
 *   - blackboardPostings       → shared pull workspace. observation /
 *                                hypothesis / question / plan / result.
 *                                Tenant-scoped, RLS.
 *   - coordinationConflicts    → detected contradictions over
 *                                mutation_proposals (Wave 18S). Tenant-
 *                                scoped, RLS.
 *
 * All four tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// active_agents — real-time registry of running agents
// ============================================================================

export const activeAgents = pgTable(
  'active_agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Canonical agent identifier (e.g. mr-mwikila, mining-safety-officer). */
    agentId: text('agent_id').notNull(),
    /** root_md | district_md | specialisation | spawned_wave | background_worker */
    agentKind: text('agent_kind').notNull(),
    /** Wave 18Y org-unit id. NULL = tenant_root. */
    scopeId: text('scope_id'),
    /** { kind, id, summary, role? } — the subject the agent is working on. */
    subject: jsonb('subject'),
    /** Hierarchical reference — parent agent in a supervisor/worker run. */
    parentAgentId: text('parent_agent_id'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expectedCompletionAt: timestamp('expected_completion_at', {
      withTimezone: true,
    }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** running | paused | completed | crashed */
    status: text('status').notNull().default('running'),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    subjectIdx: index('idx_aa_subject').on(table.tenantId),
    runningIdx: index('idx_aa_running').on(
      table.tenantId,
      table.status,
      table.heartbeatAt,
    ),
    parentIdx: index('idx_aa_parent').on(table.tenantId, table.parentAgentId),
  }),
);

// ============================================================================
// agent_messages — A2A push channel
// ============================================================================

export const agentMessages = pgTable(
  'agent_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    fromAgentId: text('from_agent_id').notNull(),
    /** Direct recipient. NULL for broadcast or subject-scoped. */
    toAgentId: text('to_agent_id'),
    /** {kind, id} — set when delivery is subject-scoped. */
    toSubject: jsonb('to_subject'),
    /** inform | request | coordinate | conflict | handoff */
    messageKind: text('message_kind').notNull(),
    payload: jsonb('payload').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ackAt: timestamp('ack_at', { withTimezone: true }),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    toIdx: index('idx_am_to').on(table.tenantId, table.toAgentId, table.ackAt),
    subjectIdx: index('idx_am_subject').on(table.tenantId),
    fromIdx: index('idx_am_from').on(
      table.tenantId,
      table.fromAgentId,
      table.sentAt,
    ),
  }),
);

// ============================================================================
// blackboard_postings — shared pull workspace
// ============================================================================

export const blackboardPostings = pgTable(
  'blackboard_postings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    scopeId: text('scope_id'),
    postedByAgentId: text('posted_by_agent_id').notNull(),
    /** {kind, id} — subject the contribution is against. */
    subject: jsonb('subject').notNull(),
    /** observation | hypothesis | question | plan | result */
    contributionKind: text('contribution_kind').notNull(),
    payload: jsonb('payload').notNull(),
    supersedesPostingId: uuid('supersedes_posting_id'),
    postedAt: timestamp('posted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    subjectIdx: index('idx_bp_subject').on(table.tenantId, table.scopeId),
    supersedesIdx: index('idx_bp_supersedes').on(
      table.tenantId,
      table.supersedesPostingId,
    ),
  }),
);

// ============================================================================
// coordination_conflicts — detected contradictions
// ============================================================================

export const coordinationConflicts = pgTable(
  'coordination_conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** {kind, id} — subject of the conflict. */
    subject: jsonb('subject').notNull(),
    /** References mutation_proposals.id from Wave 18S. */
    conflictingProposalIds: uuid('conflicting_proposal_ids')
      .array()
      .notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** ai_reconciled | owner_picked | both_rejected. NULL while open. */
    resolutionKind: text('resolution_kind'),
    reconciliationPayload: jsonb('reconciliation_payload'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    subjectIdx: index('idx_cc_subject').on(table.tenantId, table.detectedAt),
    unresolvedIdx: index('idx_cc_unresolved').on(
      table.tenantId,
      table.detectedAt,
    ),
  }),
);

// ============================================================================
// Inferred types — public surface
// ============================================================================

export type ActiveAgentRow = typeof activeAgents.$inferSelect;
export type NewActiveAgentRow = typeof activeAgents.$inferInsert;

export type AgentMessageRow = typeof agentMessages.$inferSelect;
export type NewAgentMessageRow = typeof agentMessages.$inferInsert;

export type BlackboardPostingRow = typeof blackboardPostings.$inferSelect;
export type NewBlackboardPostingRow = typeof blackboardPostings.$inferInsert;

export type CoordinationConflictRow =
  typeof coordinationConflicts.$inferSelect;
export type NewCoordinationConflictRow =
  typeof coordinationConflicts.$inferInsert;
