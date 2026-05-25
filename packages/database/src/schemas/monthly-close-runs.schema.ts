/**
 * monthly_close_runs + monthly_close_run_steps (migration 0099 — Wave 28
 * Phase A Agent PhA2). Persists the per-tenant run-state + step-by-step
 * audit for `MonthlyCloseOrchestrator`.
 *
 * The orchestrator runs on the 1st of every month at 02:00 UTC; each
 * (tenant_id, period_year, period_month) triple is unique so re-runs
 * are idempotent (409 CONFLICT from the trigger endpoint, OR resumed
 * if the existing row is still in progress). Steps re-entry is also
 * idempotent: the unique (run_id, step_name) index lets the orchestrator
 * check for an existing record before re-running a step, so resumes
 * after crash or `awaiting_approval` are safe.
 */

import {
  pgTable,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';

export const monthlyCloseRuns = pgTable(
  'monthly_close_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    periodYear: integer('period_year').notNull(),
    periodMonth: integer('period_month').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('running'),
    trigger: text('trigger').notNull().default('cron'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    triggeredBy: text('triggered_by').notNull().default('system'),
    reconciledPayments: integer('reconciled_payments').notNull().default(0),
    statementsGenerated: integer('statements_generated').notNull().default(0),
    kraMriTotalMinor: bigint('kra_mri_total_minor', { mode: 'number' })
      .notNull()
      .default(0),
    disbursementTotalMinor: bigint('disbursement_total_minor', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    currency: text('currency'),
    summaryJson: jsonb('summary_json').notNull().default({}),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantPeriodIdx: uniqueIndex('idx_monthly_close_runs_tenant_period').on(
      t.tenantId,
      t.periodYear,
      t.periodMonth,
    ),
    tenantStatusIdx: index('idx_monthly_close_runs_tenant_status').on(
      t.tenantId,
      t.status,
    ),
    tenantStartedIdx: index('idx_monthly_close_runs_tenant_started').on(
      t.tenantId,
      t.startedAt.desc(),
    ),
    statusCheck: check(
      'monthly_close_runs_status_chk',
      sql`${t.status} IN ('running', 'awaiting_approval', 'completed', 'failed', 'skipped')`,
    ),
    periodCheck: check(
      'monthly_close_runs_period_chk',
      sql`${t.periodMonth} BETWEEN 1 AND 12 AND ${t.periodYear} BETWEEN 2020 AND 2100`,
    ),
  }),
);

export const monthlyCloseRunSteps = pgTable(
  'monthly_close_run_steps',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => monthlyCloseRuns.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    stepName: text('step_name').notNull(),
    stepIndex: integer('step_index').notNull(),
    decision: text('decision').notNull(),
    actor: text('actor').notNull().default('system'),
    policyRule: text('policy_rule'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    resultJson: jsonb('result_json').notNull().default({}),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    runStepIdx: uniqueIndex('idx_monthly_close_run_steps_run_step').on(
      t.runId,
      t.stepName,
    ),
    tenantRunIdx: index('idx_monthly_close_run_steps_tenant_run').on(
      t.tenantId,
      t.runId,
    ),
    runIndexIdx: index('idx_monthly_close_run_steps_run_index').on(
      t.runId,
      t.stepIndex,
    ),
    decisionCheck: check(
      'monthly_close_run_steps_decision_chk',
      sql`${t.decision} IN ('executed', 'auto_approved', 'awaiting_approval', 'approved', 'skipped', 'failed')`,
    ),
  }),
);

export type MonthlyCloseRunRecord = typeof monthlyCloseRuns.$inferSelect;
export type NewMonthlyCloseRunRecord = typeof monthlyCloseRuns.$inferInsert;
export type MonthlyCloseRunStepRecord =
  typeof monthlyCloseRunSteps.$inferSelect;
export type NewMonthlyCloseRunStepRecord =
  typeof monthlyCloseRunSteps.$inferInsert;
