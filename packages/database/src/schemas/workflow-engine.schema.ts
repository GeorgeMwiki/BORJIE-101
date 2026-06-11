/**
 * workflow-engine durable persistence (migration 0307) — the Postgres backing
 * for `@borjie/workflow-engine`'s three persistence ports.
 *
 * The engine is the maker-checker / four-eyes spine (open → in_progress →
 * in_review → in_approval → committed | rejected | cancelled). Until migration
 * 0307 the api-gateway wired only in-memory repositories, so every `/workflow`
 * run, the four-eyes approval queue, and the "append-only" hashed audit chain
 * were lost on restart. These three tables back the Drizzle adapters in
 * `packages/workflow-engine/src/runs/drizzle-repos.ts`.
 *
 * Column mapping onto the ports:
 *   - workflow_runs        ← WorkflowRun (lifecycle projection; nested value
 *                            objects stored as jsonb).
 *   - workflow_run_events  ← WorkflowRunEvent (append-only event log).
 *   - workflow_audit_chain ← AuditChainEntry (SHA-256 tamper-evident chain).
 *
 * Tenant scope (CLAUDE.md hard rule — mirrors migrations 0289 / 0295 / 0302):
 * every `tenant_id` is TEXT and FK→tenants; all three tables FORCE-enable RLS
 * on the canonical `app.current_tenant_id` GUC, with a service-role bypass for
 * the engine's globally-unique-by-id reads (findById/getRun).
 *
 * The jsonb value-object types are declared structurally here (NOT imported
 * from `@borjie/workflow-engine`) so the database package keeps zero dependency
 * on the engine package — the adapter maps between these row shapes and the
 * engine's typed records.
 *
 * Companion to:
 *   - packages/database/src/migrations/0307_workflow_engine_durable_repos.sql
 *   - packages/workflow-engine/src/runs/drizzle-repos.ts
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

/**
 * Structural shapes for the jsonb value-objects. Kept loose (the engine owns
 * the canonical typed records) but explicit enough to keep callers honest.
 */
export type WorkflowRunInput = Record<string, unknown>;
export type WorkflowProposedChangeJson = Record<string, unknown>;
export type WorkflowReviewDecisionJson = Record<string, unknown>;
export type WorkflowApprovalDecisionJson = Record<string, unknown>;
export type WorkflowEventPayloadJson = Record<string, unknown>;

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    definitionId: text('definition_id').notNull(),
    kind: text('kind').notNull(),
    scope: text('scope').notNull(),
    scopeRef: text('scope_ref').notNull(),
    initiatedByUserId: text('initiated_by_user_id').notNull(),
    assignedReviewerUserId: text('assigned_reviewer_user_id'),
    /** Set when a run reaches `in_approval` — the four-eyes approval queue. */
    assignedApproverUserId: text('assigned_approver_user_id'),
    state: text('state').notNull(),
    input: jsonb('input').$type<WorkflowRunInput>().notNull().default({}),
    proposedChange: jsonb('proposed_change').$type<WorkflowProposedChangeJson>(),
    reviewDecision: jsonb('review_decision').$type<WorkflowReviewDecisionJson>(),
    approvalDecision: jsonb(
      'approval_decision',
    ).$type<WorkflowApprovalDecisionJson>(),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantInitiatorIdx: index('idx_workflow_runs_tenant_initiator').on(
      t.tenantId,
      t.initiatedByUserId,
    ),
    tenantStateIdx: index('idx_workflow_runs_tenant_state').on(
      t.tenantId,
      t.state,
    ),
  }),
);

export const workflowRunEvents = pgTable(
  'workflow_run_events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    actorUserId: text('actor_user_id'),
    payload: jsonb('payload')
      .$type<WorkflowEventPayloadJson>()
      .notNull()
      .default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    runIdx: index('idx_workflow_run_events_run').on(t.runId, t.occurredAt),
  }),
);

export const workflowAuditChain = pgTable(
  'workflow_audit_chain',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    previousHash: text('previous_hash').notNull(),
    currentHash: text('current_hash').notNull(),
    recordedKind: text('recorded_kind').notNull(),
    recordedPayload: jsonb('recorded_payload')
      .$type<WorkflowEventPayloadJson>()
      .notNull()
      .default({}),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantRecordedIdx: index('idx_workflow_audit_chain_tenant_recorded').on(
      t.tenantId,
      t.recordedAt,
    ),
    runIdx: index('idx_workflow_audit_chain_run').on(t.runId, t.recordedAt),
    tenantHashUq: unique('workflow_audit_chain_tenant_hash_uq').on(
      t.tenantId,
      t.currentHash,
    ),
  }),
);

export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
export type WorkflowRunInsertRow = typeof workflowRuns.$inferInsert;
export type WorkflowRunEventRow = typeof workflowRunEvents.$inferSelect;
export type WorkflowRunEventInsertRow = typeof workflowRunEvents.$inferInsert;
export type WorkflowAuditChainRow = typeof workflowAuditChain.$inferSelect;
export type WorkflowAuditChainInsertRow = typeof workflowAuditChain.$inferInsert;
