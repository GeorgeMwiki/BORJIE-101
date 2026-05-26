/**
 * Calibration + Interpretability persistence (Wave 18BB-gap).
 *
 * Companion to Docs/DESIGN/CALIBRATION_INTERPRETABILITY_SPEC.md and
 * migration 0037_calibration_interpretability.sql. Drizzle types for
 * the three tables forming the continuous calibration loop +
 * mechanistic interpretability persistence:
 *
 *   - calibrationObservations    → one row per Tier-1+ prediction at
 *                                  decision time. Triple
 *                                  (tenant_id, prediction_kind,
 *                                  entity_id) is unique. Tenant-scoped,
 *                                  RLS-bound.
 *   - calibrationWeeklyReports   → one row per (tenant, kind, period)
 *                                  emitted by weekly-report-generator.
 *                                  Stores brier_score, ece,
 *                                  sample_size, reliability_diagram.
 *                                  Tenant-scoped, RLS-bound.
 *   - saeProbeFeatures           → one row per fired SAE feature per
 *                                  probe call. Tenant-scoped,
 *                                  RLS-bound.
 *
 * All three tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern). All three are written exclusively through
 * the audit-hash chain (`@borjie/audit-hash-chain`).
 *
 * Consumed by `@borjie/calibration-monitor` and `@borjie/sae-probe`.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  numeric,
  smallint,
  index,
  unique,
} from 'drizzle-orm/pg-core';

// ============================================================================
// calibration_observations — observe → resolve store
// ============================================================================

export const calibrationObservations = pgTable(
  'calibration_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    predictionKind: text('prediction_kind').notNull(),
    entityId: text('entity_id').notNull(),
    predictedConfidence: numeric('predicted_confidence', {
      precision: 4,
      scale: 3,
    }).notNull(),
    predictedLabel: text('predicted_label').notNull(),
    outcomeLabel: text('outcome_label'),
    /** 0 / 1 once resolved (binary outcome only). */
    outcomeValue: smallint('outcome_value'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tripleUnique: unique('calibration_observation_unique_triple').on(
      t.tenantId,
      t.predictionKind,
      t.entityId,
    ),
    tenantKindResolvedIdx: index('idx_calobs_tenant_kind_resolved').on(
      t.tenantId,
      t.predictionKind,
      t.resolvedAt,
    ),
    tenantCreatedIdx: index('idx_calobs_tenant_created').on(
      t.tenantId,
      t.createdAt,
    ),
  }),
);

export type CalibrationObservationRow =
  typeof calibrationObservations.$inferSelect;
export type CalibrationObservationInsert =
  typeof calibrationObservations.$inferInsert;

// ============================================================================
// calibration_weekly_reports — Brier + ECE + reliability diagram
// ============================================================================

export const calibrationWeeklyReports = pgTable(
  'calibration_weekly_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    predictionKind: text('prediction_kind').notNull(),
    reportPeriodStart: timestamp('report_period_start', {
      withTimezone: true,
    }).notNull(),
    reportPeriodEnd: timestamp('report_period_end', {
      withTimezone: true,
    }).notNull(),
    sampleSize: integer('sample_size').notNull(),
    brierScore: numeric('brier_score', { precision: 6, scale: 5 }).notNull(),
    ece: numeric('ece', { precision: 6, scale: 5 }).notNull(),
    /** ReliabilityBin[] serialised as jsonb. */
    reliabilityDiagram: jsonb('reliability_diagram').notNull().default([]),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantKindPeriodIdx: index('idx_calreport_tenant_kind_period').on(
      t.tenantId,
      t.predictionKind,
      t.reportPeriodStart,
    ),
    tenantGeneratedIdx: index('idx_calreport_tenant_generated').on(
      t.tenantId,
      t.generatedAt,
    ),
  }),
);

export type CalibrationWeeklyReportRow =
  typeof calibrationWeeklyReports.$inferSelect;
export type CalibrationWeeklyReportInsert =
  typeof calibrationWeeklyReports.$inferInsert;

// ============================================================================
// sae_probe_features — SAE runtime firing log
// ============================================================================

export const saeProbeFeatures = pgTable(
  'sae_probe_features',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    sessionId: text('session_id').notNull(),
    turnId: text('turn_id').notNull(),
    featureId: text('feature_id').notNull(),
    featureLabel: text('feature_label').notNull(),
    /**
     * One of: deception, hallucination, bias, sycophancy,
     * prompt_injection, self_reference, confidentiality_leak.
     * SQL CHECK constraint in migration 0037 enforces the set.
     */
    category: text('category').notNull(),
    activationStrength: numeric('activation_strength', {
      precision: 10,
      scale: 6,
    }).notNull(),
    thresholdAtTime: numeric('threshold_at_time', {
      precision: 10,
      scale: 6,
    }).notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantFeatureRecentIdx: index('idx_sae_tenant_feature_recent').on(
      t.tenantId,
      t.featureLabel,
      t.detectedAt,
    ),
    tenantSessionIdx: index('idx_sae_tenant_session').on(
      t.tenantId,
      t.sessionId,
      t.detectedAt,
    ),
    tenantCategoryRecentIdx: index('idx_sae_tenant_category_recent').on(
      t.tenantId,
      t.category,
      t.detectedAt,
    ),
  }),
);

export type SaeProbeFeatureRow = typeof saeProbeFeatures.$inferSelect;
export type SaeProbeFeatureInsert = typeof saeProbeFeatures.$inferInsert;
