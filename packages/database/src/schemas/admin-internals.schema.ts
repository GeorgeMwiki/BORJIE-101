/**
 * admin_internals — platform-staff admin console tables (migration 0008).
 *
 * Backs the three NET-NEW Borjie HQ admin domains that have no other
 * primary store. The other four admin endpoints (decision-log / SLO /
 * killswitch-read / citations) reuse the existing tables exported from
 * sibling schema files (decision_traces, audit_events / ai_cost_entries,
 * platform_killswitch_state, intelligence_corpus_chunks).
 *
 * All three tables are platform-scoped — they hold rows that span every
 * tenant (regulator changes / prompt promotions) or escalations raised
 * BY the per-tenant Compliance Agent FOR platform-staff triage. The
 * `compliance_escalations` table carries a `tenant_id` for context but
 * remains in the platform table-space; RLS is enabled but no per-tenant
 * SELECT policy is declared — the service-role admin client bypasses
 * RLS for these surfaces.
 *
 * Companion migration: `packages/database/drizzle/0008_admin_internals.sql`.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

/**
 * Kanban-shaped tracker for regulator changes flowing from external
 * sources (Gazette, NEMC, Tumemadini, BoT, TRA) into the Borjie
 * corpus. Status walks `incoming -> reviewing -> approved -> pushed`.
 */
export const regulatorPipelineEntries = pgTable(
  'regulator_pipeline_entries',
  {
    id: text('id').primaryKey(),
    /** One of: 'gazette' | 'nemc' | 'bot' | 'tra' | 'tumemadini'. */
    source: text('source').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    /** Source URL (gazette PDF, regulator portal, etc.). */
    url: text('url'),
    /** One of: 'incoming' | 'reviewing' | 'approved' | 'pushed'. */
    status: text('status').notNull().default('incoming'),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    pushedToCorpusAt: timestamp('pushed_to_corpus_at', { withTimezone: true }),
    reviewedByUserId: text('reviewed_by_user_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index('regulator_pipeline_entries_status_idx').on(
      t.status,
      t.capturedAt,
    ),
    sourceIdx: index('regulator_pipeline_entries_source_idx').on(
      t.source,
      t.capturedAt,
    ),
    capturedAtIdx: index('regulator_pipeline_entries_captured_at_idx').on(
      t.capturedAt,
    ),
  }),
);

export type RegulatorPipelineEntry =
  typeof regulatorPipelineEntries.$inferSelect;
export type NewRegulatorPipelineEntry =
  typeof regulatorPipelineEntries.$inferInsert;

/**
 * Append-only history of prompt / model / corpus version promotions.
 * Surfaced by the rollback UI and the "recent promotions" widget on
 * the operator dashboard. `kind` discriminates the subject domain;
 * `from_version` is nullable for first-ever publishes.
 */
export const promptPromotions = pgTable(
  'prompt_promotions',
  {
    id: text('id').primaryKey(),
    /** One of: 'prompt' | 'model' | 'corpus'. */
    kind: text('kind').notNull().default('prompt'),
    /** Human-readable subject — capability / model id / corpus file. */
    subject: text('subject').notNull(),
    /** Capability handle when `kind = 'prompt'`; mirrors subject otherwise. */
    promptName: text('prompt_name'),
    fromVersion: text('from_version'),
    toVersion: text('to_version').notNull(),
    promotedByUserId: text('promoted_by_user_id').notNull(),
    promotedAt: timestamp('promoted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
    revertedByUserId: text('reverted_by_user_id'),
    revertReason: text('revert_reason'),
    canRevert: boolean('can_revert').notNull().default(true),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    promotedAtIdx: index('prompt_promotions_promoted_at_idx').on(t.promotedAt),
    kindIdx: index('prompt_promotions_kind_idx').on(t.kind, t.promotedAt),
    subjectIdx: index('prompt_promotions_subject_idx').on(
      t.subject,
      t.promotedAt,
    ),
  }),
);

export type PromptPromotion = typeof promptPromotions.$inferSelect;
export type NewPromptPromotion = typeof promptPromotions.$inferInsert;

/**
 * Escalations raised by the per-tenant Compliance Agent that require
 * platform-staff review. `tenant_id` is the originating tenant (kept
 * for context); `evidence_ids` is a JSONB array of audit/decision-
 * trace ids the Compliance Agent flagged when escalating.
 */
export const complianceEscalations = pgTable(
  'compliance_escalations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    /** Agent that raised the escalation (e.g. 'compliance-agent'). */
    agentSource: text('agent_source').notNull(),
    /** One of: 'low' | 'medium' | 'high' | 'critical'. */
    severity: text('severity').notNull().default('medium'),
    summary: text('summary').notNull(),
    /** JSONB array of evidence ids (audit_events.id / decision_traces.id). */
    evidenceIds: jsonb('evidence_ids').notNull().default([]),
    escalatedAt: timestamp('escalated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: text('resolved_by_user_id'),
    /** Operator decision when closing — 'approve' | 'reject' | 'defer'. */
    resolutionDecision: text('resolution_decision'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('compliance_escalations_tenant_idx').on(
      t.tenantId,
      t.escalatedAt,
    ),
    severityIdx: index('compliance_escalations_severity_idx').on(
      t.severity,
      t.escalatedAt,
    ),
  }),
);

export type ComplianceEscalation = typeof complianceEscalations.$inferSelect;
export type NewComplianceEscalation =
  typeof complianceEscalations.$inferInsert;
