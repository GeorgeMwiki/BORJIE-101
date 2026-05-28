/**
 * Outcome Telemetry - Wave CLOSED-LOOP (migration 0114).
 *
 * Companion to:
 *   - packages/database/src/migrations/0114_outcome_telemetry.sql
 *   - services/api-gateway/src/workers/outcome-reconciliation-worker.ts
 *   - services/api-gateway/src/composition/brain-tools/outcome-predictor.ts
 *   - services/api-gateway/src/services/calibration-monitor/
 *
 * Three tables back the closed-loop telemetry contract: every action
 * proposed by the brain (or taken by the owner / an agent / an external
 * system) declares a predicted outcome, is reconciled against the
 * observed outcome after N days, and feeds a learning_signal back so
 * future predictions calibrate.
 *
 * Tenant-scoped. RLS FORCE-enabled (see migration). Every prediction
 * and reconciliation links into the AI hash-chain via `auditHashId` so
 * tampering with either table breaks chain verification on the next
 * walk.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  integer,
  numeric,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** Actor taxonomy for outcome_predictions.actor_kind. */
export const OUTCOME_ACTOR_KINDS = ['brain', 'owner', 'agent', 'external'] as const;
export type OutcomeActorKind = (typeof OUTCOME_ACTOR_KINDS)[number];

/** Reconciliation verdicts. */
export const OUTCOME_RECONCILIATION_STATUSES = [
  'matched',
  'divergent',
  'expired',
  'undetermined',
] as const;
export type OutcomeReconciliationStatus =
  (typeof OUTCOME_RECONCILIATION_STATUSES)[number];

export const outcomePredictions = pgTable(
  'outcome_predictions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    actionKind: text('action_kind').notNull(),
    actionTargetEntityType: text('action_target_entity_type').notNull(),
    actionTargetEntityId: text('action_target_entity_id').notNull(),
    predictedOutcome: jsonb('predicted_outcome').notNull().default({}),
    predictionConfidence: numeric('prediction_confidence', {
      precision: 4,
      scale: 3,
    })
      .notNull()
      .default('0.000'),
    predictionHorizonDays: integer('prediction_horizon_days')
      .notNull()
      .default(30),
    predictedValueTzs: numeric('predicted_value_tzs', {
      precision: 20,
      scale: 2,
    }),
    rationale: text('rationale').notNull().default(''),
    auditHashId: text('audit_hash_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantDueIdx: index('outcome_predictions_tenant_due_idx').on(
      table.tenantId,
      table.createdAt,
      table.predictionHorizonDays,
    ),
    actorKindIdx: index('outcome_predictions_actor_kind_idx').on(
      table.tenantId,
      table.actorKind,
      table.actionKind,
      table.createdAt,
    ),
    entityIdx: index('outcome_predictions_entity_idx').on(
      table.tenantId,
      table.actionTargetEntityType,
      table.actionTargetEntityId,
      table.createdAt,
    ),
  }),
);

export const outcomeObservations = pgTable(
  'outcome_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    predictionId: uuid('prediction_id').notNull(),
    observedOutcome: jsonb('observed_outcome').notNull().default({}),
    observedValueTzs: numeric('observed_value_tzs', {
      precision: 20,
      scale: 2,
    }),
    observedAt: timestamp('observed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    gapPct: numeric('gap_pct', { precision: 6, scale: 4 }),
    calibrated: boolean('calibrated').notNull().default(false),
    narrative: text('narrative').notNull().default(''),
  },
  (table) => ({
    onePerPredictionIdx: uniqueIndex(
      'outcome_observations_one_per_prediction_idx',
    ).on(table.tenantId, table.predictionId),
    calibratedIdx: index('outcome_observations_calibrated_idx').on(
      table.tenantId,
      table.calibrated,
      table.observedAt,
    ),
  }),
);

export const outcomeReconciliations = pgTable(
  'outcome_reconciliations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    predictionId: uuid('prediction_id').notNull(),
    observationId: uuid('observation_id'),
    status: text('status').notNull(),
    driftScore: numeric('drift_score', { precision: 6, scale: 4 })
      .notNull()
      .default('0.0'),
    learningSignal: jsonb('learning_signal').notNull().default({}),
    auditHashId: text('audit_hash_id'),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    onePerPredictionIdx: uniqueIndex(
      'outcome_reconciliations_one_per_prediction_idx',
    ).on(table.tenantId, table.predictionId),
    statusIdx: index('outcome_reconciliations_status_idx').on(
      table.tenantId,
      table.status,
      table.reconciledAt,
    ),
  }),
);

export type OutcomePrediction = typeof outcomePredictions.$inferSelect;
export type NewOutcomePrediction = typeof outcomePredictions.$inferInsert;
export type OutcomeObservation = typeof outcomeObservations.$inferSelect;
export type NewOutcomeObservation = typeof outcomeObservations.$inferInsert;
export type OutcomeReconciliation = typeof outcomeReconciliations.$inferSelect;
export type NewOutcomeReconciliation =
  typeof outcomeReconciliations.$inferInsert;
