/**
 * conformal_calibration (migration 0299) — online ACI coverage-feedback loop.
 *
 * Three durable tables that turn `@borjie/conformal-calibration-online` (a PURE
 * Adaptive Conformal Inference state machine) into a REAL feedback loop:
 *
 *   conformalPredictions       — one row per emitted prediction + its interval
 *                                and the alpha in force when it was produced.
 *   conformalObservations      — one row per landed outcome (covered or not);
 *                                the `covered` bit is what the ACI update reads.
 *   conformalCalibrationState  — one row per (tenant, predictionType): the
 *                                persisted ACI state (alpha + rolling window +
 *                                immutable config) so alpha survives restarts.
 *
 * The calibrated `alpha` is fed back into the brain's confidence path
 * (cognitive-engine confidence-calibrator) where it SHIFTS the thresholds.
 *
 * Tenant scope (CLAUDE.md hard rule — mirrors legal_drafts / migration 0289):
 * tenant_id is TEXT and FK→tenants; every table FORCE-enables RLS on the
 * canonical `app.current_tenant_id` GUC. The Drizzle store also filters every
 * read by tenantId for defence-in-depth.
 *
 * Currency neutrality (CLAUDE.md hard rule): no money column here — a predicted
 * interval / observed value is a domain-neutral double; any monetary fact the
 * prediction is ABOUT lives in the free-form `metadata` jsonb (minor-units +
 * currency), never a typed money column or currency literal.
 *
 * Companion to:
 *   - packages/database/src/migrations/0299_conformal_calibration.sql
 *   - services/api-gateway/src/composition/conformal/drizzle-conformal-store.ts
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  doublePrecision,
  integer,
  bigint,
  jsonb,
  timestamp,
  index,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';

/**
 * One element of the persisted ACI rolling window. Mirrors
 * `CoverageObservation` from `@borjie/conformal-calibration-online` — declared
 * locally to keep `@borjie/database` free of that import.
 */
export interface ConformalRecentObservation {
  readonly predictedCovered: boolean;
  readonly observedAtIso: string;
}

export const conformalPredictions = pgTable(
  'conformal_predictions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    predictionId: text('prediction_id').notNull(),
    predictionType: text('prediction_type').notNull(),
    predictedValue: doublePrecision('predicted_value'),
    predictedLower: doublePrecision('predicted_lower'),
    predictedUpper: doublePrecision('predicted_upper'),
    alphaAtEmit: doublePrecision('alpha_at_emit').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .$type<Readonly<Record<string, unknown>>>()
      .default({}),
    predictedAt: timestamp('predicted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by'),
  },
  (t) => ({
    tenantTypeAtIdx: index('idx_conformal_predictions_tenant_type_at').on(
      t.tenantId,
      t.predictionType,
      t.predictedAt.desc(),
    ),
    tenantPredictionUq: unique('conformal_predictions_tenant_prediction_uq').on(
      t.tenantId,
      t.predictionId,
    ),
    alphaCheck: check(
      'conformal_predictions_alpha_chk',
      sql`${t.alphaAtEmit} BETWEEN 0 AND 1`,
    ),
  }),
);

export const conformalObservations = pgTable(
  'conformal_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    predictionId: text('prediction_id').notNull(),
    predictionType: text('prediction_type').notNull(),
    observedValue: doublePrecision('observed_value'),
    covered: boolean('covered').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .$type<Readonly<Record<string, unknown>>>()
      .default({}),
    observedAt: timestamp('observed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by'),
  },
  (t) => ({
    tenantTypeAtIdx: index('idx_conformal_observations_tenant_type_at').on(
      t.tenantId,
      t.predictionType,
      t.observedAt.desc(),
    ),
    tenantPredictionUq: unique('conformal_observations_tenant_prediction_uq').on(
      t.tenantId,
      t.predictionId,
    ),
  }),
);

export const conformalCalibrationState = pgTable(
  'conformal_calibration_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    predictionType: text('prediction_type').notNull(),
    targetCoverage: doublePrecision('target_coverage').notNull().default(0.9),
    alpha: doublePrecision('alpha').notNull().default(0.1),
    learningRate: doublePrecision('learning_rate').notNull().default(0.05),
    windowSize: integer('window_size').notNull().default(200),
    recent: jsonb('recent')
      .notNull()
      .$type<ReadonlyArray<ConformalRecentObservation>>()
      .default([]),
    observationsCount: bigint('observations_count', { mode: 'number' })
      .notNull()
      .default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantTypeIdx: index('idx_conformal_state_tenant_type').on(
      t.tenantId,
      t.predictionType,
    ),
    tenantTypeUq: unique('conformal_state_tenant_type_uq').on(
      t.tenantId,
      t.predictionType,
    ),
    alphaCheck: check(
      'conformal_state_alpha_chk',
      sql`${t.alpha} BETWEEN 0 AND 1`,
    ),
    targetCheck: check(
      'conformal_state_target_chk',
      sql`${t.targetCoverage} BETWEEN 0 AND 1`,
    ),
    windowCheck: check(
      'conformal_state_window_chk',
      sql`${t.windowSize} > 0`,
    ),
  }),
);

export type ConformalPredictionRecord = typeof conformalPredictions.$inferSelect;
export type NewConformalPredictionRecord =
  typeof conformalPredictions.$inferInsert;
export type ConformalObservationRecord =
  typeof conformalObservations.$inferSelect;
export type NewConformalObservationRecord =
  typeof conformalObservations.$inferInsert;
export type ConformalCalibrationStateRecord =
  typeof conformalCalibrationState.$inferSelect;
export type NewConformalCalibrationStateRecord =
  typeof conformalCalibrationState.$inferInsert;
