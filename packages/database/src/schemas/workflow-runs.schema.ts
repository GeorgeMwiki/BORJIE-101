/**
 * Workflow runs — durable persistence for `@borjie/workflow-engine`.
 *
 * Companion to:
 *   - packages/database/src/migrations/0307_workflow_engine_durable_repos.sql
 *   - packages/workflow-engine/src/repositories/drizzle-run-repository.ts
 *   - packages/workflow-engine/src/types.ts (WorkflowRun)
 *
 * The run aggregate is a single-row projection of the append-only
 * `workflow_run_events` log. `state` drives the review queue
 * (state='in_review') and the four-eyes approval queue
 * (state='in_approval'). The proposed-change / review-decision /
 * approval-decision sub-objects are stored as jsonb so a run row is
 * self-contained.
 *
 * Tenant-scoped via the canonical `app.current_tenant_id` GUC RLS
 * policy; FORCE RLS per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    definitionId: text('definition_id').notNull(),
    kind: text('kind').notNull(),
    scope: text('scope').notNull(),
    scopeRef: text('scope_ref').notNull(),
    initiatedByUserId: text('initiated_by_user_id').notNull(),
    assignedReviewerUserId: text('assigned_reviewer_user_id'),
    assignedApproverUserId: text('assigned_approver_user_id'),
    state: text('state').notNull().default('open'),
    input: jsonb('input').notNull().default({}),
    proposedChange: jsonb('proposed_change'),
    reviewDecision: jsonb('review_decision'),
    approvalDecision: jsonb('approval_decision'),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (table) => ({
    tenantIdx: index('workflow_runs_tenant_idx').on(table.tenantId),
    tenantStateIdx: index('workflow_runs_tenant_state_idx').on(
      table.tenantId,
      table.state,
    ),
    tenantInitiatorIdx: index('workflow_runs_tenant_initiator_idx').on(
      table.tenantId,
      table.initiatedByUserId,
    ),
  }),
);

export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
export type NewWorkflowRunRow = typeof workflowRuns.$inferInsert;
