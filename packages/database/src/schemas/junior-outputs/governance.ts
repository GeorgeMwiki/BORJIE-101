/**
 * Governance junior outputs — decision log, audit log, compliance
 * verdicts, contract remediation, notifications outbox, generated
 * reports. Backs the master-brain, auditor, compliance, contract-
 * currency-auditor, notifications-router, report-writer juniors.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  jsonb,
  index,
  tenants,
} from './_shared.js';

// Decision log — master brain dispatch trace.
export const decisionLog = pgTable(
  'decision_log',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    query: text('query').notNull(),
    dispatchPlan: jsonb('dispatch_plan').notNull().default({}),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('decision_log_tenant_idx').on(t.tenantId),
    createdIdx: index('decision_log_tenant_created_idx').on(t.tenantId, t.createdAt),
  }),
);

// Audit log — auditor agent verdict per recommendation.
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recommendation: jsonb('recommendation').notNull().default({}),
    verdict: text('verdict').notNull(),
    missing: text('missing').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('audit_log_tenant_idx').on(t.tenantId),
    verdictIdx: index('audit_log_verdict_idx').on(t.tenantId, t.verdict),
  }),
);

// Compliance verdicts.
export const complianceVerdicts = pgTable(
  'compliance_verdicts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actionKind: text('action_kind').notNull(),
    compliant: boolean('compliant').notNull(),
    summary: jsonb('summary').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('compliance_verdicts_tenant_idx').on(t.tenantId),
    actionIdx: index('compliance_verdicts_action_idx').on(t.tenantId, t.actionKind),
  }),
);

// Contract remediation.
export const contractRemediation = pgTable(
  'contract_remediation',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    totalExposureTzs: numeric('total_exposure_tzs', { precision: 18, scale: 2 }),
    summary: jsonb('summary').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('contract_remediation_tenant_idx').on(t.tenantId),
    statusIdx: index('contract_remediation_status_idx').on(t.tenantId, t.status),
  }),
);

// Generated reports.
export const generatedReports = pgTable(
  'generated_reports',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    cadence: text('cadence').notNull(),
    audience: text('audience').notNull(),
    language: text('language').notNull(),
    title: text('title').notNull(),
    wordCount: integer('word_count').notNull().default(0),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('generated_reports_tenant_idx').on(t.tenantId),
    cadenceIdx: index('generated_reports_cadence_idx').on(t.tenantId, t.cadence),
  }),
);

// Notifications outbox.
export const notificationsOutbox = pgTable(
  'notifications_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recipientUserId: text('recipient_user_id').notNull(),
    category: text('category').notNull(),
    severity: text('severity').notNull(),
    summary: jsonb('summary').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('notifications_outbox_tenant_idx').on(t.tenantId),
    recipientIdx: index('notifications_outbox_recipient_idx').on(
      t.tenantId,
      t.recipientUserId,
    ),
    categoryIdx: index('notifications_outbox_category_idx').on(t.tenantId, t.category),
  }),
);

export type DecisionLog = typeof decisionLog.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type ComplianceVerdict = typeof complianceVerdicts.$inferSelect;
export type ContractRemediationRow = typeof contractRemediation.$inferSelect;
export type GeneratedReport = typeof generatedReports.$inferSelect;
export type NotificationOutbox = typeof notificationsOutbox.$inferSelect;
