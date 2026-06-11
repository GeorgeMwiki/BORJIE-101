/**
 * Workflow run events — append-only transition log for
 * `@borjie/workflow-engine`.
 *
 * Companion to:
 *   - packages/database/src/migrations/0307_workflow_engine_durable_repos.sql
 *   - packages/workflow-engine/src/repositories/drizzle-run-event-repository.ts
 *   - packages/workflow-engine/src/types.ts (WorkflowRunEvent)
 *
 * One row per state transition (started / change_proposed / reviewed /
 * approved / committed / ...). Never updated, never deleted — the run
 * aggregate in `workflow_runs` is the projection of this log.
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

export const workflowRunEvents = pgTable(
  'workflow_run_events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    kind: text('kind').notNull(),
    actorUserId: text('actor_user_id'),
    payload: jsonb('payload').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    runIdx: index('workflow_run_events_run_idx').on(
      table.runId,
      table.occurredAt,
    ),
    tenantIdx: index('workflow_run_events_tenant_idx').on(table.tenantId),
  }),
);

export type WorkflowRunEventRow = typeof workflowRunEvents.$inferSelect;
export type NewWorkflowRunEventRow = typeof workflowRunEvents.$inferInsert;
