/**
 * Payroll runs + payroll line items.
 *
 * Companion to migration 0134. Closes payroll chain L-B (issue #193).
 *
 * State machine
 * -------------
 * payroll_runs:
 *   draft     -> previewed   (Mwikila computed line items from clock + shift data)
 *   previewed -> committed   (owner committed -> LedgerService.post() fired)
 *   committed -> paid        (all line items terminal-paid via M-Pesa callbacks)
 *   committed -> failed      (at least one line item terminal-failed)
 *
 * payroll_line_items:
 *   pending   -> posted      (ledger journal id stamped post-CAS)
 *   posted    -> paid        (M-Pesa B2C callback OK)
 *   posted    -> failed      (M-Pesa terminal failure)
 *
 * Money path
 * ----------
 * The commit endpoint MUST call `LedgerService.post()` for each line
 * item (CLAUDE.md hard rule). The returned journal id is stamped onto
 * `payroll_line_items.ledger_txn_id` so the audit view can show the
 * full debit (payroll-expense) / credit (cash-or-bank) chain.
 *
 * Tenant-isolation: RLS FORCE-enabled in migration 0134.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  integer,
  uuid,
  date,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// payroll_runs — header row per (tenant, period)
// ============================================================================

export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /** Owner who triggered the run. */
    createdByUserId: text('created_by_user_id').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    /** draft | previewed | committed | paid | failed. */
    status: text('status').notNull().default('draft'),
    /** Sum of all line_items.net_tzs. Stamped at preview-time. */
    totalTzs: numeric('total_tzs', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    workerCount: integer('worker_count').notNull().default(0),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    previewedAt: timestamp('previewed_at', { withTimezone: true }),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusCreatedIdx: index(
      'idx_payroll_runs_tenant_status_created',
    ).on(t.tenantId, t.status, t.createdAt),
  }),
);

export type PayrollRun = typeof payrollRuns.$inferSelect;
export type NewPayrollRun = typeof payrollRuns.$inferInsert;

// ============================================================================
// payroll_line_items — one row per (run, worker)
// ============================================================================

export const payrollLineItems = pgTable(
  'payroll_line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    payrollRunId: uuid('payroll_run_id').notNull(),
    workerUserId: text('worker_user_id').notNull(),
    hoursWorked: numeric('hours_worked', { precision: 8, scale: 2 })
      .notNull()
      .default('0'),
    overtimeHours: numeric('overtime_hours', { precision: 8, scale: 2 })
      .notNull()
      .default('0'),
    hourlyRateTzs: numeric('hourly_rate_tzs', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    baseTzs: numeric('base_tzs', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    overtimeTzs: numeric('overtime_tzs', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    bonusTzs: numeric('bonus_tzs', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    deductionTzs: numeric('deduction_tzs', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    netTzs: numeric('net_tzs', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    /** pending | posted | paid | failed. */
    status: text('status').notNull().default('pending'),
    /** LedgerService journal id. Stamped post-CAS at commit-time. */
    ledgerTxnId: text('ledger_txn_id'),
    payoutProvider: text('payout_provider'),
    payoutProviderRef: text('payout_provider_ref'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => ({
    tenantRunIdx: index('idx_payroll_line_items_tenant_run').on(
      t.tenantId,
      t.payrollRunId,
    ),
    workerStatusIdx: index('idx_payroll_line_items_worker_status').on(
      t.tenantId,
      t.workerUserId,
      t.status,
    ),
  }),
);

export type PayrollLineItem = typeof payrollLineItems.$inferSelect;
export type NewPayrollLineItem = typeof payrollLineItems.$inferInsert;
