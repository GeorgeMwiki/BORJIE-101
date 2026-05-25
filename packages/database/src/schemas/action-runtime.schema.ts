/**
 * Action runtime schemas — Piece E.
 *
 * Three tenant-scoped tables and one optionally-tenant-scoped lookup table:
 *
 *   action_plans                       — saga root (DRAFT → COMPLETED|COMPENSATED)
 *   action_steps                       — per-step state (PENDING → SUCCEEDED|COMPENSATED)
 *   action_quotas                      — daily counters per (tenant, persona|NULL, date)
 *   approval_matrix_dsl_compiled       — compiled DSL rules for K5 routing
 *
 * All four tables are RLS-FORCED in the migrations (0225–0228) under the
 * gold-standard `tenant_isolation_*` policies. The `approval_matrix_dsl_compiled`
 * table allows reads of `tenant_id IS NULL` (platform default) rows.
 */

import {
  pgTable,
  text,
  integer,
  smallint,
  jsonb,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────
// action_plans
// ─────────────────────────────────────────────────────────────────────

export const actionPlans = pgTable(
  'action_plans',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    personaId: text('persona_id').notNull(),
    moduleId: text('module_id'),
    intent: text('intent').notNull(),
    planJsonb: jsonb('plan_jsonb').notNull(),
    status: text('status').notNull().default('DRAFT'),
    auditChainLink: text('audit_chain_link'),
    budgetMicros: integer('budget_micros').notNull(),
    budgetUsedMicros: integer('budget_used_micros').notNull().default(0),
    sourceCaptureId: text('source_capture_id'),
    sourceBriefId: text('source_brief_id'),
    sourceDocumentId: text('source_document_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`NOW() + INTERVAL '72 hours'`),
  },
  (t) => ({
    tenantStatusIdx: index('idx_action_plans_tenant_status').on(
      t.tenantId,
      t.status,
    ),
    personaIdx: index('idx_action_plans_persona').on(t.tenantId, t.personaId),
    intentIdx: index('idx_action_plans_intent').on(t.tenantId, t.intent),
    expiresIdx: index('idx_action_plans_expires').on(t.expiresAt),
    statusCheck: check(
      'action_plans_status_chk',
      sql`${t.status} IN ('DRAFT','ROUTED_FOR_APPROVAL','APPROVED','EXECUTING','PARTIAL','COMPLETED','FAILED','COMPENSATED','COMPENSATION_FAILED','EXPIRED','CANCELLED')`,
    ),
    budgetCheck: check(
      'action_plans_budget_chk',
      sql`${t.budgetMicros} >= 0 AND ${t.budgetUsedMicros} >= 0`,
    ),
  }),
);

export type ActionPlanRow = typeof actionPlans.$inferSelect;
export type ActionPlanInsert = typeof actionPlans.$inferInsert;

// ─────────────────────────────────────────────────────────────────────
// action_steps
// ─────────────────────────────────────────────────────────────────────

export const actionSteps = pgTable(
  'action_steps',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    stepIndex: smallint('step_index').notNull(),
    kind: text('kind').notNull(),
    payloadJsonb: jsonb('payload_jsonb').notNull().default(sql`'{}'::jsonb`),
    toolCallRef: text('tool_call_ref'),
    otelSpanId: text('otel_span_id'),
    auditChainId: text('audit_chain_id'),
    status: text('status').notNull().default('PENDING'),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    compensationStepIndex: smallint('compensation_step_index'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    planStepUq: uniqueIndex('action_steps_plan_step_idx').on(
      t.planId,
      t.stepIndex,
    ),
    planIdx: index('idx_action_steps_plan').on(t.planId, t.stepIndex),
    tenantStatusIdx: index('idx_action_steps_tenant_status').on(
      t.tenantId,
      t.status,
    ),
    toolCallRefIdx: index('idx_action_steps_tool_call_ref').on(
      t.tenantId,
      t.toolCallRef,
    ),
    kindIdx: index('idx_action_steps_kind').on(t.tenantId, t.kind),
    kindCheck: check(
      'action_steps_kind_chk',
      sql`${t.kind} IN ('DRAFT_LETTER','ROUTE_APPROVAL','POST_LEDGER','FILE_GEPG','SEND_WHATSAPP','SEND_SMS','SEND_EMAIL','SCHEDULE_FIELD_VISIT','MUTATE_ENTITY','CALL_EXTERNAL_API','EMIT_WEBHOOK','NOTIFY','VERIFY','COMPENSATE')`,
    ),
    statusCheck: check(
      'action_steps_status_chk',
      sql`${t.status} IN ('PENDING','RUNNING','SUCCEEDED','FAILED','COMPENSATING','COMPENSATED','SKIPPED')`,
    ),
    stepIndexCheck: check(
      'action_steps_step_index_chk',
      sql`${t.stepIndex} >= 0`,
    ),
    attemptsCheck: check(
      'action_steps_attempts_chk',
      sql`${t.attempts} >= 0`,
    ),
  }),
);

export type ActionStepRow = typeof actionSteps.$inferSelect;
export type ActionStepInsert = typeof actionSteps.$inferInsert;

// ─────────────────────────────────────────────────────────────────────
// action_quotas
// ─────────────────────────────────────────────────────────────────────

export const actionQuotas = pgTable(
  'action_quotas',
  {
    tenantId: text('tenant_id').notNull(),
    personaId: text('persona_id'),
    periodDate: date('period_date').notNull(),
    plansCreated: integer('plans_created').notNull().default(0),
    plansApproved: integer('plans_approved').notNull().default(0),
    plansExecuted: integer('plans_executed').notNull().default(0),
    moneyMicros: integer('money_micros').notNull().default(0),
    budgetMicrosUsed: integer('budget_micros_used').notNull().default(0),
  },
  (t) => ({
    // The migration uses COALESCE(persona_id, '') in the PK; Drizzle's
    // primaryKey() can't express that, so we emit a composite PK on the
    // three columns and accept that the migration is the source of truth
    // for the COALESCE-NULL idiom.
    pk: primaryKey({ columns: [t.tenantId, t.personaId, t.periodDate] }),
    periodIdx: index('idx_action_quotas_period').on(t.periodDate),
    personaIdx: index('idx_action_quotas_persona').on(
      t.tenantId,
      t.personaId,
      t.periodDate,
    ),
    plansCreatedCheck: check(
      'action_quotas_plans_created_chk',
      sql`${t.plansCreated} >= 0`,
    ),
    moneyCheck: check(
      'action_quotas_money_chk',
      sql`${t.moneyMicros} >= 0 AND ${t.budgetMicrosUsed} >= 0`,
    ),
  }),
);

export type ActionQuotaRow = typeof actionQuotas.$inferSelect;
export type ActionQuotaInsert = typeof actionQuotas.$inferInsert;

// ─────────────────────────────────────────────────────────────────────
// approval_matrix_dsl_compiled
// ─────────────────────────────────────────────────────────────────────

export const approvalMatrixDslCompiled = pgTable(
  'approval_matrix_dsl_compiled',
  {
    id: text('id').primaryKey(),
    /** NULL = platform default. */
    tenantId: text('tenant_id'),
    ruleSlug: text('rule_slug').notNull(),
    predicateJsonb: jsonb('predicate_jsonb').notNull(),
    requiredRoleGroup: text('required_role_group').notNull(),
    quorum: smallint('quorum').notNull().default(1),
    notifyRoleGroup: text('notify_role_group'),
    priority: smallint('priority').notNull().default(100),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    priorityIdx: index('idx_approval_matrix_priority').on(
      t.tenantId,
      t.priority,
    ),
    activeIdx: index('idx_approval_matrix_active').on(t.active),
    quorumCheck: check(
      'approval_matrix_quorum_chk',
      sql`${t.quorum} >= 1 AND ${t.quorum} <= 10`,
    ),
  }),
);

export type ApprovalMatrixDslCompiledRow =
  typeof approvalMatrixDslCompiled.$inferSelect;
export type ApprovalMatrixDslCompiledInsert =
  typeof approvalMatrixDslCompiled.$inferInsert;
