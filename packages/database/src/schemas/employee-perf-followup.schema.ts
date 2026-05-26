/**
 * Employee Daily Performance Follow-up persistence (Wave PERF-1).
 *
 * Companion to Docs/DESIGN/EMPLOYEE_DAILY_PERFORMANCE_FOLLOWUP_SPEC.md.
 * Drizzle types for the three tables created by migration
 * 0058_employee_perf_followup.sql:
 *
 *   - kpiTemplates        → per-(tenant, role) catalogue of KPI
 *                            definitions. Default templates ship as
 *                            tenant_id='__seed__' seed rows; tenants
 *                            override by inserting their own tenant_id
 *                            with the same role.
 *   - employeeScorecards  → one row per (tenant, employee, date) with
 *                            per-KPI raw measurements, computed bands,
 *                            overall_score and a signals jsonb. Hash-
 *                            chained via (prev_hash, audit_hash) for
 *                            forensic replay.
 *   - perfNudges          → one row per dispatched nudge. recipient_tier
 *                            in {subject, supervisor, owner} so the
 *                            FOUNDER_LOCKED §3 tiered rendering is
 *                            queryable post-hoc.
 *
 * All three tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern). The `kpi_templates` table additionally
 * permits read-visible seed rows under the sentinel tenant_id
 * '__seed__' (no INSERT/UPDATE from tenant scope).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  real,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// kpi_templates — per-(tenant, role) KPI definitions
// ============================================================================

export const kpiTemplates = pgTable(
  'kpi_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Seed templates use '__seed__'; tenants override with own id. */
    tenantId: text('tenant_id').notNull(),
    /** Role this template applies to. */
    role: text('role').notNull(),
    /** Array of KPI definitions:
     *  [{id, label, target, weight, measure_fn_name, direction}]. */
    kpiDefinitions: jsonb('kpi_definitions').notNull(),
    auditHash: text('audit_hash').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantRoleUq: uniqueIndex('uq_kpi_templates_tenant_role').on(
      t.tenantId,
      t.role,
    ),
    roleIdx: index('idx_kpi_templates_role').on(t.role),
  }),
);

export type KpiTemplateRow = typeof kpiTemplates.$inferSelect;
export type KpiTemplateInsert = typeof kpiTemplates.$inferInsert;

// ============================================================================
// employee_scorecards — per-(tenant, employee, date) scorecard
// ============================================================================

export const employeeScorecards = pgTable(
  'employee_scorecards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    employeeUserId: text('employee_user_id').notNull(),
    /** Local-date the scorecard covers. */
    date: date('date').notNull(),
    /** Per-KPI raw + bands + contribution: [{kpi_id, raw, band, contribution}]. */
    kpis: jsonb('kpis').notNull().default([]),
    /** Sum of contributions, clamped to [0, 1]. */
    overallScore: real('overall_score').notNull().default(0),
    /** Free-form anomalies + insights. */
    signals: jsonb('signals').notNull().default({}),
    /** Previous chained hash; empty string for genesis. */
    prevHash: text('prev_hash').notNull().default(''),
    auditHash: text('audit_hash').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    employeeDateUq: uniqueIndex('uq_employee_scorecards_employee_date').on(
      t.tenantId,
      t.employeeUserId,
      t.date,
    ),
    recentIdx: index('idx_employee_scorecards_recent').on(
      t.tenantId,
      t.date,
    ),
    employeeRecentIdx: index('idx_employee_scorecards_employee_recent').on(
      t.tenantId,
      t.employeeUserId,
      t.date,
    ),
  }),
);

export type EmployeeScorecardRow = typeof employeeScorecards.$inferSelect;
export type EmployeeScorecardInsert = typeof employeeScorecards.$inferInsert;

// ============================================================================
// perf_nudges — one row per dispatched nudge (subject / supervisor / owner)
// ============================================================================

export const perfNudges = pgTable(
  'perf_nudges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    scorecardId: uuid('scorecard_id')
      .notNull()
      .references(() => employeeScorecards.id, { onDelete: 'cascade' }),
    recipientUserId: text('recipient_user_id').notNull(),
    /** subject | supervisor | owner per FOUNDER_LOCKED §3. */
    recipientTier: text('recipient_tier').notNull(),
    /** Rendered nudge body — full text / redacted summary / empty per tier. */
    content: text('content').notNull().default(''),
    /** inapp | email | whatsapp. */
    channel: text('channel').notNull().default('inapp'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    auditHash: text('audit_hash').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    recipientIdx: index('idx_perf_nudges_recipient').on(
      t.tenantId,
      t.recipientUserId,
      t.createdAt,
    ),
    scorecardIdx: index('idx_perf_nudges_scorecard').on(t.scorecardId),
    tierIdx: index('idx_perf_nudges_tier').on(
      t.tenantId,
      t.recipientTier,
      t.createdAt,
    ),
  }),
);

export type PerfNudgeRow = typeof perfNudges.$inferSelect;
export type PerfNudgeInsert = typeof perfNudges.$inferInsert;
