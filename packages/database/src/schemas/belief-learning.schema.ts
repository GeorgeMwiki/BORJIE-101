/**
 * Belief-engine + learning-signal persistence (LP-17/18).
 *
 * Drizzle backing for migration 0274_litfin_belief_learning.sql. Tables
 * power the new `@borjie/belief-engine` + `@borjie/learning-signal-emitter`
 * packages — re-skinned from LITFIN's brain_beliefs / belief_revisions /
 * preference_pairs to the Borjie mining-estate domain (NO lending/PD/credit).
 *
 * Every table is tenant-scoped via a NULLABLE `tenant_id` and the canonical
 * tenant-nullable RLS idiom (platform-wide rows where tenant_id IS NULL are the
 * shared ground truth; tenant rows gate on the app.current_tenant_id GUC).
 * RLS FORCE + anon/authenticated revoked live in the migration.
 *
 * NOTE for the serial pass: this file is NOT yet barrel-exported from
 * `schemas/index.ts` (Agent D may not edit existing schema barrels). Add
 * `export * from './belief-learning.schema.js';` during the serial
 * reconciliation pass.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  doublePrecision,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─── brain_beliefs ──────────────────────────────────────────────────────────

export const brainBeliefs = pgTable(
  'brain_beliefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL ⇒ platform-wide / domain-scoped fact (shared ground truth). */
    tenantId: text('tenant_id'),
    domain: text('domain').notNull(),
    /** Canonical lowercase-dashed key, e.g. 'mwanza-gold-ore-grade'. */
    subject: text('subject').notNull(),
    description: text('description').notNull(),
    /** Typed BeliefValue (scalar | range | categorical | boolean | text). */
    valueJsonb: jsonb('value_jsonb').notNull(),
    confidence: doublePrecision('confidence').notNull().default(0.1),
    /** Evidence chain — array of BeliefSource objects. */
    sourcesJsonb: jsonb('sources_jsonb').notNull().default([]),
    revisedAt: timestamp('revised_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revisionCount: integer('revision_count').notNull().default(0),
    tags: jsonb('tags').notNull().default([]),
    /** iter-52-isolation C1: nullable per-user / per-org belief scope. */
    subjectUserId: text('subject_user_id'),
    subjectOrgId: text('subject_org_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('idx_brain_beliefs_tenant').on(t.tenantId),
    domainIdx: index('idx_brain_beliefs_domain').on(t.domain),
    revisedIdx: index('idx_brain_beliefs_revised').on(t.revisedAt),
  }),
);

// ─── belief_revisions (append-only) ───────────────────────────────────────────

export const beliefRevisions = pgTable(
  'belief_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id'),
    beliefId: uuid('belief_id').notNull(),
    beforeJsonb: jsonb('before_jsonb').notNull(),
    afterJsonb: jsonb('after_jsonb').notNull(),
    rationale: text('rationale').notNull(),
    newSourcesJsonb: jsonb('new_sources_jsonb').notNull().default([]),
    confidenceDelta: doublePrecision('confidence_delta').notNull().default(0),
    triggeredBy: text('triggered_by').notNull().default('signal-emitter'),
    subjectUserId: text('subject_user_id'),
    subjectOrgId: text('subject_org_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    beliefIdx: index('idx_belief_revisions_belief').on(t.beliefId),
    tenantIdx: index('idx_belief_revisions_tenant').on(t.tenantId),
  }),
);

// ─── belief_review_queue (the 0.05–0.25 split band) ──────────────────────────

export const beliefReviewQueue = pgTable(
  'belief_review_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id'),
    beliefId: uuid('belief_id').notNull(),
    subject: text('subject').notNull(),
    proposedValueJsonb: jsonb('proposed_value_jsonb').notNull(),
    confidenceDelta: doublePrecision('confidence_delta').notNull(),
    rationale: text('rationale').notNull(),
    /** pending | accepted | rejected */
    status: text('status').notNull().default('pending'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
    subjectUserId: text('subject_user_id'),
    subjectOrgId: text('subject_org_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index('idx_belief_review_queue_status').on(t.status),
    tenantIdx: index('idx_belief_review_queue_tenant').on(t.tenantId),
  }),
);

// ─── learning_signals ─────────────────────────────────────────────────────────

export const learningSignals = pgTable(
  'learning_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id'),
    /** sha256(actionRef|outcomeRef|reward) — idempotency key. */
    signalHash: text('signal_hash').notNull(),
    actionRef: text('action_ref').notNull(),
    actionKind: text('action_kind').notNull(),
    outcomeRef: text('outcome_ref'),
    reward: doublePrecision('reward').notNull(),
    componentsJsonb: jsonb('components_jsonb').notNull().default({}),
    /** user | org | platform */
    tenantScope: text('tenant_scope').notNull(),
    routedToJsonb: jsonb('routed_to_jsonb').notNull().default([]),
    emittedBy: text('emitted_by').notNull(),
    decisionTraceId: text('decision_trace_id'),
    subjectUserId: text('subject_user_id'),
    subjectOrgId: text('subject_org_id'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    hashUq: uniqueIndex('uq_learning_signals_hash').on(t.signalHash),
    tenantIdx: index('idx_learning_signals_tenant').on(t.tenantId),
    actionIdx: index('idx_learning_signals_action').on(t.actionRef),
  }),
);

// ─── preference_pairs (DPO winner/loser feature deltas) ──────────────────────

export const preferencePairs = pgTable(
  'preference_pairs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id'),
    contextHash: text('context_hash').notNull(),
    winnerFeatures: jsonb('winner_features').notNull(),
    loserFeatures: jsonb('loser_features').notNull(),
    winnerReward: doublePrecision('winner_reward').notNull(),
    loserReward: doublePrecision('loser_reward').notNull(),
    /** user | org | platform */
    tenantScope: text('tenant_scope').notNull(),
    subjectUserId: text('subject_user_id'),
    subjectOrgId: text('subject_org_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('idx_preference_pairs_tenant').on(t.tenantId),
    contextIdx: index('idx_preference_pairs_context').on(t.contextHash),
    createdIdx: index('idx_preference_pairs_created').on(t.createdAt),
  }),
);

// ─── preference_head_weights (trained DPO head — one active row) ─────────────

export const preferenceHeadWeights = pgTable(
  'preference_head_weights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id'),
    version: text('version').notNull(),
    weights: jsonb('weights').notNull(),
    d: integer('d').notNull(),
    beta: doublePrecision('beta').notNull().default(0.1),
    seenPairs: integer('seen_pairs').notNull().default(0),
    nTrainingPairs: integer('n_training_pairs').notNull().default(0),
    active: boolean('active').notNull().default(false),
    trainedAt: timestamp('trained_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// ─── correlation_findings (nightly belief×outcome Pearson pass) ──────────────

export const correlationFindings = pgTable(
  'correlation_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id'),
    sector: text('sector'),
    region: text('region'),
    beliefSubject: text('belief_subject').notNull(),
    outcomeMetric: text('outcome_metric').notNull(),
    pearsonR: doublePrecision('pearson_r').notNull(),
    pValue: doublePrecision('p_value').notNull(),
    sampleSize: integer('sample_size').notNull(),
    summary: text('summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('idx_correlation_findings_tenant').on(t.tenantId),
    subjectIdx: index('idx_correlation_findings_subject').on(t.beliefSubject),
  }),
);
