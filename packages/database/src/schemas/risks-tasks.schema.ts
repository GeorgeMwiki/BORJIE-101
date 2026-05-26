/**
 * Risks + tasks — Borjie mining domain.
 *
 * Per DATA_MODEL.md §3.6. Lightweight task + risk register that the AI
 * agents read/write to track follow-ups. `tasks` has a follow-up cadence
 * for the central agent to chase the owner; `risks` are the open
 * threat-and-mitigation list.
 *
 * `tasks` and `risks` did NOT previously exist in this repo (the legacy
 * pre-Borjie `cases.schema` was deleted). These are net-new tables.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  smallint,
  jsonb,
  date,
  index,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';
import { sites } from './sites.schema.js';
import { licences } from './licences.schema.js';

export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    /** licence_renewal|sample_assay|cash_top_up|repair|csr|community|safety_followup|... */
    kind: text('kind').notNull(),
    /** 1 (lowest) - 5 (highest). */
    priority: smallint('priority').notNull().default(3),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    licenceId: text('licence_id').references(() => licences.id, {
      onDelete: 'set null',
    }),
    dueDate: date('due_date'),
    /** What evidence must be uploaded to close this task. */
    requiredEvidence: text('required_evidence').array().notNull().default([]),
    /** Other task IDs that must close first. */
    dependencies: text('dependencies').array().notNull().default([]),
    costImplicationTzs: numeric('cost_implication_tzs', {
      precision: 18,
      scale: 2,
    }),
    riskIfDelayed: text('risk_if_delayed'),
    /** open|in_progress|blocked|done|cancelled. */
    status: text('status').notNull().default('open'),
    /** daily|every_3d|weekly|monthly. */
    aiFollowupCadence: text('ai_followup_cadence').notNull().default('weekly'),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('tasks_tenant_idx').on(t.tenantId),
    ownerIdx: index('tasks_owner_idx').on(t.ownerUserId),
    siteIdx: index('tasks_site_idx').on(t.siteId),
    statusIdx: index('tasks_status_idx').on(t.tenantId, t.status),
    dueIdx: index('tasks_due_idx').on(t.tenantId, t.dueDate),
  }),
);

// ============================================================================
// risks — open threats with mitigations
// ============================================================================

export const risks = pgTable(
  'risks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    licenceId: text('licence_id').references(() => licences.id, {
      onDelete: 'set null',
    }),
    /** licence|safety|environmental|community|cash|fx|geology|equipment|legal|fraud. */
    kind: text('kind').notNull(),
    /** low|medium|high|critical. */
    severity: text('severity').notNull().default('medium'),
    description: text('description'),
    mitigations: text('mitigations').array().notNull().default([]),
    /** open|mitigated|accepted|escalated|closed. */
    status: text('status').notNull().default('open'),
    /** Probability 0.00-1.00. */
    likelihood: numeric('likelihood', { precision: 3, scale: 2 }),
    /** Expected cost impact in TZS. */
    impactTzs: numeric('impact_tzs', { precision: 18, scale: 2 }),
    ownerUserId: text('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    evidenceIds: text('evidence_ids').array().notNull().default([]),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('risks_tenant_idx').on(t.tenantId),
    siteIdx: index('risks_site_idx').on(t.siteId),
    kindIdx: index('risks_kind_idx').on(t.tenantId, t.kind),
    statusIdx: index('risks_status_idx').on(t.tenantId, t.status),
    severityIdx: index('risks_severity_idx').on(t.tenantId, t.severity),
  }),
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Risk = typeof risks.$inferSelect;
export type NewRisk = typeof risks.$inferInsert;
