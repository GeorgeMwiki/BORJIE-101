/**
 * org_loop_runs persistence — the SELF-RUNNING-ORG SPINE correlation identity
 * (the durable join between an md_commitment and the mining_task it spawned,
 * plus the stage/status of each closed-loop run).
 *
 * Companion to migration 0341_org_loop_runs.sql and the
 * `OrgLoopRunRepository` port (../repositories/org-loop-run-repository.ts).
 *
 * One durable row per loop RUN. It is the identity that JOINS the originating
 * `md_commitments` row (migration 0321) to the `mining_tasks` row the workforce
 * orchestrator spawned, and records WHICH stage the run is in. Without this join
 * the closed loop cannot be re-read, resumed, or closed: a worker completing a
 * task could never reach back to the commitment that asked for it, and the
 * matcher could never learn from the run.
 *
 *   - `stage` — the stage-machine position (detect → strategize → pick →
 *     assign → dispatch → deliver → report → reloop → closed).
 *   - `status` — the honest lifecycle (open | active | closed | failed).
 *   - `commitmentId` — the originating `md_commitments.id` (the close-the-loop
 *     back-edge); `taskId` — the spawned `mining_tasks.id` (the dispatch
 *     forward-edge). No FKs: the same tenant-scoped, FK-free convention as
 *     md_commitments / md_commitment_timeline.
 *   - `strategyJson` — the strategize step's composed plan.
 *   - `chosenEmployeeId` + `matchConfidence` — the pick step's decision (the
 *     matcher-learning inputs).
 *   - `sourceData` + `evidenceIds` — the detect step's grounding (the
 *     evidence-required hard rule travels with the loop).
 *
 * The loop ENGINE is universal Mr-Mwikila core; `loopKind` / `stage` /
 * `sourceData` are domain-pack DATA — this row is the declarative substrate the
 * loop-economy LoopSpec composes over, never a hardcoded per-vertical branch.
 *
 * Tenant-scoped, RLS FORCE (canonical `app.current_tenant_id` GUC +
 * service-role bypass for the out-of-band loop-economy cron), migration 0341.
 * NULL-tenant rows are never written by this store.
 */

import {
  pgTable,
  uuid,
  text,
  numeric,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/** The stage-machine position of a loop run. */
export type OrgLoopRunStage =
  | 'detect'
  | 'strategize'
  | 'pick'
  | 'assign'
  | 'dispatch'
  | 'deliver'
  | 'report'
  | 'reloop'
  | 'closed';

/** The honest lifecycle of a loop run. */
export type OrgLoopRunStatus = 'open' | 'active' | 'closed' | 'failed';

// ============================================================================
// org_loop_runs — one durable row per loop run (the spine correlation identity).
// ============================================================================

export const orgLoopRuns = pgTable(
  'org_loop_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** The originating md_commitments.id this run closes (the back-edge). */
    commitmentId: text('commitment_id').notNull(),
    /** WHICH universal loop this is (loop-economy LoopSpec id). Domain-pack DATA. */
    loopKind: text('loop_kind').notNull().default('gap_to_delegate'),
    /** The stage-machine position. */
    stage: text('stage')
      .$type<OrgLoopRunStage>()
      .notNull()
      .default('strategize'),
    /** The honest lifecycle. */
    status: text('status')
      .$type<OrgLoopRunStatus>()
      .notNull()
      .default('open'),
    /** The loop-economy drive that fired this run (nullable). */
    driveId: text('drive_id'),
    /** The strategize step's composed plan. */
    strategyJson: jsonb('strategy_json').$type<Record<string, unknown>>(),
    /** The pick step's decision — the chosen workforce person (matcher output). */
    chosenEmployeeId: text('chosen_employee_id'),
    /**
     * The matcher's confidence in that pick (the learning signal; 0..1). A
     * Postgres `numeric` round-trips through the driver as a string; the
     * repository converts to/from a JS number at its boundary.
     */
    matchConfidence: numeric('match_confidence'),
    /** The spawned mining_tasks.id this run dispatched (the forward-edge). */
    taskId: text('task_id'),
    /** The detect step's grounding payload (gap snapshot, drive context, ...). */
    sourceData: jsonb('source_data')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Evidence-required hard rule: the evidence ids threaded from the commitment. */
    evidenceIds: jsonb('evidence_ids')
      .$type<ReadonlyArray<string>>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Dispatch back-reference: task completion reaches back to its loop run.
    taskIdx: index('org_loop_runs_task_idx').on(t.tenantId, t.taskId),
    // Commitment forward-reference: dispatcher finds the live run for a commitment.
    commitmentIdx: index('org_loop_runs_commitment_idx').on(
      t.tenantId,
      t.commitmentId,
    ),
    // The loop-economy cron's hot scan: open/active runs by stage for a tenant.
    statusStageIdx: index('org_loop_runs_status_stage_idx').on(
      t.tenantId,
      t.status,
      t.stage,
    ),
  }),
);

export type OrgLoopRunRow = typeof orgLoopRuns.$inferSelect;
export type OrgLoopRunInsert = typeof orgLoopRuns.$inferInsert;
