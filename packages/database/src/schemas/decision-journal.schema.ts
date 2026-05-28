/**
 * Decision Journal — Wave DECISION-LEGIBILITY (migration 0116).
 *
 * Companion to:
 *   - packages/database/src/migrations/0116_decision_journal.sql
 *   - services/api-gateway/src/services/decision-journal/recorder.ts
 *   - services/api-gateway/src/workers/decision-retrospective-worker.ts
 *   - services/api-gateway/src/composition/brain-tools/decision-journal-tools.ts
 *
 * Three append-only, hash-chained tables that make every decision —
 * owner-made, brain-suggested-and-applied, four-eye approved, or
 * automated-policy enacted — fully legible:
 *
 *   decisions          one row per recorded decision. Captures the
 *                      chosen value, alternatives considered, rationale,
 *                      confidence, and a hash chained from the previous
 *                      row for the tenant.
 *   decision_outcomes  retrospective grade written by the worker once
 *                      the prediction horizon elapses (or by the owner
 *                      manually marking a decision in chat).
 *   decision_links     graph linking supersedes / depends_on /
 *                      informed_by / reversed_by relationships between
 *                      decisions.
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS policy.
 * FORCE RLS is enabled per CLAUDE.md hard rule. Every row is
 * hash-chained per the @borjie/audit-hash-chain primitive — auditors
 * can replay verifyChain() to detect mutation.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  numeric,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ─── enums (mirrored from the SQL CHECK constraints) ─────────────────

export const DECIDED_BY_KINDS = [
  'owner',
  'brain',
  'agent_apply',
  'four_eye',
  'automated_policy',
] as const;
export type DecidedByKind = (typeof DECIDED_BY_KINDS)[number];

export const DECISION_STATUSES = [
  'committed',
  'rolled_back',
  'superseded',
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const RETROSPECTIVE_GRADES = [
  'good',
  'neutral',
  'bad',
  'undetermined',
] as const;
export type RetrospectiveGrade = (typeof RETROSPECTIVE_GRADES)[number];

export const OUTCOME_RECORDERS = ['reconciler', 'owner', 'brain'] as const;
export type OutcomeRecorder = (typeof OUTCOME_RECORDERS)[number];

export const DECISION_LINK_RELATIONSHIPS = [
  'supersedes',
  'depends_on',
  'informed_by',
  'reversed_by',
] as const;
export type DecisionLinkRelationship =
  (typeof DECISION_LINK_RELATIONSHIPS)[number];

// ─── decisions ──────────────────────────────────────────────────────

export const decisions = pgTable(
  'decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    decidedByKind: text('decided_by_kind').notNull(),
    decidedByActorId: text('decided_by_actor_id').notNull(),
    decisionSubject: text('decision_subject').notNull(),
    decisionSubjectEntityKind: text('decision_subject_entity_kind'),
    decisionSubjectEntityId: text('decision_subject_entity_id'),
    decidedValue: jsonb('decided_value').notNull(),
    alternativesConsidered: jsonb('alternatives_considered')
      .notNull()
      .default([]),
    rationale: text('rationale').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    scopeIds: text('scope_ids').array().notNull().default([]),
    relatedPredictionId: text('related_prediction_id'),
    relatedActionAuditHash: text('related_action_audit_hash'),
    status: text('status').notNull().default('committed'),
    provenance: jsonb('provenance').notNull().default({}),
    entryHash: text('entry_hash').notNull(),
    prevHash: text('prev_hash'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantRecentIdx: index('decisions_tenant_recent_idx').on(
      table.tenantId,
      table.decidedAt,
    ),
    tenantKindIdx: index('decisions_tenant_kind_idx').on(
      table.tenantId,
      table.decidedByKind,
      table.decidedAt,
    ),
    predictionIdx: index('decisions_prediction_idx').on(
      table.tenantId,
      table.relatedPredictionId,
    ),
    tenantChainIdx: index('decisions_tenant_chain_idx').on(
      table.tenantId,
      table.decidedAt,
    ),
  }),
);

export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;

// ─── decision_outcomes ──────────────────────────────────────────────

export const decisionOutcomes = pgTable(
  'decision_outcomes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    outcomeSummary: text('outcome_summary').notNull(),
    observedValueTzs: numeric('observed_value_tzs', { precision: 18, scale: 2 }),
    observedAt: timestamp('observed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    retrospectiveGrade: text('retrospective_grade').notNull(),
    learnings: text('learnings'),
    recordedBy: text('recorded_by').notNull(),
    entryHash: text('entry_hash').notNull(),
    prevHash: text('prev_hash'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    decisionIdx: index('decision_outcomes_decision_idx').on(
      table.tenantId,
      table.decisionId,
      table.observedAt,
    ),
    gradeIdx: index('decision_outcomes_grade_idx').on(
      table.tenantId,
      table.retrospectiveGrade,
      table.observedAt,
    ),
  }),
);

export type DecisionOutcome = typeof decisionOutcomes.$inferSelect;
export type NewDecisionOutcome = typeof decisionOutcomes.$inferInsert;

// ─── decision_links ─────────────────────────────────────────────────

export const decisionLinks = pgTable(
  'decision_links',
  {
    tenantId: text('tenant_id').notNull(),
    sourceDecisionId: uuid('source_decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    targetDecisionId: uuid('target_decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    relationship: text('relationship').notNull(),
    note: text('note'),
    entryHash: text('entry_hash').notNull(),
    prevHash: text('prev_hash'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [
        table.sourceDecisionId,
        table.targetDecisionId,
        table.relationship,
      ],
    }),
    sourceIdx: index('decision_links_source_idx').on(
      table.tenantId,
      table.sourceDecisionId,
    ),
    targetIdx: index('decision_links_target_idx').on(
      table.tenantId,
      table.targetDecisionId,
    ),
  }),
);

export type DecisionLink = typeof decisionLinks.$inferSelect;
export type NewDecisionLink = typeof decisionLinks.$inferInsert;
