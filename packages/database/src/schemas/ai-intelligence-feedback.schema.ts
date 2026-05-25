/**
 * AI intelligence feedback schemas — migration 0041.
 *
 *   - ai_decision_feedback: operator verdicts on Brain PROPOSED_ACTION
 *   - ai_proactive_alerts: evidence-backed alerts with action plans
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const aiDecisionFeedback = pgTable(
  'ai_decision_feedback',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    turnId: text('turn_id').notNull(),
    personaId: text('persona_id').notNull(),
    proposedVerb: text('proposed_verb').notNull(),
    proposedObject: text('proposed_object').notNull(),
    riskLevel: text('risk_level').notNull(),
    operatorVerdict: text('operator_verdict').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdx: index('idx_ai_feedback_tenant').on(
      table.tenantId,
      table.createdAt,
    ),
    personaIdx: index('idx_ai_feedback_persona').on(
      table.tenantId,
      table.personaId,
      table.createdAt,
    ),
    turnIdx: index('idx_ai_feedback_turn').on(table.tenantId, table.turnId),
  }),
);

export const aiProactiveAlerts = pgTable(
  'ai_proactive_alerts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    scopeKind: text('scope_kind').notNull(),
    scopeId: text('scope_id').notNull(),
    kind: text('kind').notNull(),
    category: text('category').notNull(),
    severity: text('severity').notNull(),
    priority: integer('priority').notNull().default(3),
    title: text('title').notNull(),
    message: text('message').notNull(),
    evidenceRefs: jsonb('evidence_refs').notNull().default([]),
    actionPlan: jsonb('action_plan').notNull().default([]),
    dataPoints: jsonb('data_points').notNull().default({}),
    requiresOperatorAction: boolean('requires_operator_action')
      .notNull()
      .default(false),
    ackAt: timestamp('ack_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdx: index('idx_proactive_alerts_tenant').on(
      table.tenantId,
      table.createdAt,
    ),
    scopeIdx: index('idx_proactive_alerts_scope').on(
      table.tenantId,
      table.scopeKind,
      table.scopeId,
    ),
  }),
);
