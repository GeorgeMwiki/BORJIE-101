/**
 * Autonomy schema — Wave-13 Autonomous Department Mode.
 *
 * Mirrors `0080_autonomous_department_mode.sql`. Four additive tables:
 *   - `autonomy_policies`          per-tenant configuration
 *   - `exception_inbox`            head-of-department decision queue
 *   - `executive_briefings`        weekly/monthly generated briefings
 *   - `autonomous_action_audit`    every autonomous decision, with reasoning
 */

import {
  pgTable,
  text,
  boolean,
  integer,
  bigint,
  doublePrecision,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const autonomyPolicies = pgTable(
  'autonomy_policies',
  {
    tenantId: text('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    autonomousModeEnabled: boolean('autonomous_mode_enabled')
      .notNull()
      .default(false),
    policyJson: jsonb('policy_json').notNull().default({}),
    escalationPrimaryUserId: text('escalation_primary_user_id'),
    escalationSecondaryUserId: text('escalation_secondary_user_id'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text('updated_by'),
  },
  (table) => ({
    enabledIdx: index('idx_autonomy_policies_enabled').on(
      table.tenantId,
      table.autonomousModeEnabled,
    ),
  }),
);

export const exceptionInbox = pgTable(
  'exception_inbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    kind: text('kind').notNull(),
    priority: text('priority').notNull().default('P2'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    amountMinorUnits: bigint('amount_minor_units', { mode: 'number' }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    strategicWeight: integer('strategic_weight').notNull().default(0),
    recommendedAction: text('recommended_action'),
    evidenceRefs: jsonb('evidence_refs').notNull().default([]),
    status: text('status').notNull().default('open'),
    resolutionDecision: text('resolution_decision'),
    resolutionNote: text('resolution_note'),
    resolvedByUserId: text('resolved_by_user_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantStatusIdx: index('idx_exception_inbox_tenant_status').on(
      table.tenantId,
      table.status,
      table.priority,
    ),
    domainIdx: index('idx_exception_inbox_domain').on(
      table.tenantId,
      table.domain,
      table.createdAt,
    ),
  }),
);

export const executiveBriefings = pgTable(
  'executive_briefings',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    cadence: text('cadence').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    headline: text('headline').notNull(),
    portfolioHealth: jsonb('portfolio_health').notNull().default({}),
    wins: jsonb('wins').notNull().default([]),
    exceptions: jsonb('exceptions').notNull().default([]),
    recommendations: jsonb('recommendations').notNull().default([]),
    focusNextPeriod: jsonb('focus_next_period').notNull().default([]),
    bodyMarkdown: text('body_markdown').notNull(),
    voiceAudioUrl: text('voice_audio_url'),
    generatedBy: text('generated_by').notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdx: index('idx_executive_briefings_tenant').on(
      table.tenantId,
      table.createdAt,
    ),
    cadenceIdx: index('idx_executive_briefings_cadence').on(
      table.tenantId,
      table.cadence,
      table.periodEnd,
    ),
  }),
);

export const autonomousActionAudit = pgTable(
  'autonomous_action_audit',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorPersona: text('actor_persona').notNull(),
    action: text('action').notNull(),
    domain: text('domain').notNull(),
    targetEntityKind: text('target_entity_kind'),
    targetEntityId: text('target_entity_id'),
    reasoning: text('reasoning').notNull(),
    evidenceRefs: jsonb('evidence_refs').notNull().default([]),
    confidence: doublePrecision('confidence').notNull().default(0),
    policyRuleMatched: text('policy_rule_matched'),
    chainId: text('chain_id'),
    reviewedByUserId: text('reviewed_by_user_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantCreatedIdx: index('idx_auton_audit_tenant_created').on(
      table.tenantId,
      table.createdAt,
    ),
    domainIdx: index('idx_auton_audit_domain').on(
      table.tenantId,
      table.domain,
      table.createdAt,
    ),
    chainIdx: index('idx_auton_audit_chain').on(table.chainId),
  }),
);
