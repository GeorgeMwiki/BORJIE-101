/**
 * agency_run_checkpoints — durable checkpoint table for the agency
 * executor (Central Command Phase A gap #7).
 *
 * One row per (run_id, step_index). The durable runner (services/
 * api-gateway/src/composition/durable/durable-runner.ts) wraps the
 * existing agency executor with retry + crash-recovery semantics by
 * persisting each step's lifecycle here BEFORE invoking the underlying
 * tool. On process crash the recovery worker scans for `state =
 * 'running'` checkpoints whose `started_at` exceeds the staleness
 * window and resumes the run from the last `success`.
 *
 * Migration 0136. The companion service (Drizzle adapter) is
 * `packages/database/src/services/agency-run-checkpoints.service.ts`.
 */
import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

/**
 * Durable lifecycle state for a single agency step. The executor's
 * existing GoalStepStatus (pending|running|done|failed|skipped) is
 * deliberately NOT reused — this enum is for the DURABLE layer's
 * resume + retry semantics, which need a `paused` terminal state that
 * the goal-status enum doesn't surface.
 */
export type AgencyCheckpointState =
  | 'pending'
  | 'running'
  | 'success'
  | 'failure'
  | 'paused';

export const AGENCY_CHECKPOINT_STATES: ReadonlyArray<AgencyCheckpointState> = [
  'pending',
  'running',
  'success',
  'failure',
  'paused',
];

export const agencyRunCheckpoints = pgTable(
  'agency_run_checkpoints',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    runId: text('run_id').notNull(),
    goalId: text('goal_id').notNull(),
    stepIndex: integer('step_index').notNull(),
    stepName: text('step_name').notNull(),
    /** AgencyCheckpointState — see enum above. */
    state: text('state').notNull(),
    /** Bumped each retry; bounded by the durable runner's max-attempts. */
    attemptCount: integer('attempt_count').notNull().default(0),
    inputPayload: jsonb('input_payload').notNull().default({}),
    outputPayload: jsonb('output_payload'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    runStepUq: unique('uq_agency_run_checkpoints_run_step').on(
      t.runId,
      t.stepIndex,
    ),
    stateIdx: index('idx_agency_checkpoints_state').on(t.state, t.startedAt),
    tenantRunIdx: index('idx_agency_checkpoints_tenant_run').on(
      t.tenantId,
      t.runId,
      t.stepIndex,
    ),
  }),
);
