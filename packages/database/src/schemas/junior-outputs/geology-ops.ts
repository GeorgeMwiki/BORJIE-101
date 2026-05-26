/**
 * Geology + operations junior outputs — licence dormancy, sample
 * batches, QAQC, geology scores, site layouts, weekly plans, SIC
 * events, shift reconciliations, junior drill holes + layers.
 *
 * Backs the licence, lab-assay, geology, mine-planner, operations-sic,
 * drill-hole-logger juniors.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  jsonb,
  date,
  index,
  tenants,
} from './_shared.js';

export const licenceDormancyScores = pgTable(
  'licence_dormancy_scores',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    licenceId: text('licence_id').notNull(),
    score: numeric('score', { precision: 4, scale: 2 }).notNull(),
    alertLevel: text('alert_level').notNull(),
    factors: jsonb('factors').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('licence_dormancy_scores_tenant_idx').on(t.tenantId),
    licenceIdx: index('licence_dormancy_scores_licence_idx').on(t.tenantId, t.licenceId),
  }),
);

export const sampleBatches = pgTable(
  'sample_batches',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id'),
    batchId: text('batch_id').notNull().unique(),
    mineral: text('mineral').notNull(),
    recommendedLab: text('recommended_lab'),
    technique: text('technique'),
    costTzs: numeric('cost_tzs', { precision: 18, scale: 2 }),
    turnaroundDays: integer('turnaround_days'),
    manifest: jsonb('manifest').notNull().default({}),
    qaqcPassed: boolean('qaqc_passed'),
    qaqcFailures: jsonb('qaqc_failures').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('sample_batches_tenant_idx').on(t.tenantId),
    mineralIdx: index('sample_batches_mineral_idx').on(t.tenantId, t.mineral),
  }),
);

export const qaqcResults = pgTable(
  'qaqc_results',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    batchId: text('batch_id').notNull(),
    passed: boolean('passed').notNull(),
    failures: jsonb('failures').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('qaqc_results_tenant_idx').on(t.tenantId),
    batchIdx: index('qaqc_results_batch_idx').on(t.tenantId, t.batchId),
  }),
);

export const geologyScores = pgTable(
  'geology_scores',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id').notNull(),
    mineral: text('mineral').notNull(),
    score: numeric('score', { precision: 4, scale: 2 }).notNull(),
    scoreBand: text('score_band').notNull(),
    veinModel: jsonb('vein_model').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('geology_scores_tenant_idx').on(t.tenantId),
    siteMineralIdx: index('geology_scores_site_mineral_idx').on(
      t.tenantId,
      t.siteId,
      t.mineral,
    ),
  }),
);

export const siteLayouts = pgTable(
  'site_layouts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id').notNull(),
    sections: jsonb('sections').notNull().default({}),
    weeklyPlan: jsonb('weekly_plan').notNull().default({}),
    matchFactor: numeric('match_factor', { precision: 5, scale: 3 }),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('site_layouts_tenant_idx').on(t.tenantId),
    siteIdx: index('site_layouts_site_idx').on(t.tenantId, t.siteId),
  }),
);

export const weeklyPlans = pgTable(
  'weekly_plans',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id').notNull(),
    weekStart: date('week_start').notNull(),
    plan: jsonb('plan').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('weekly_plans_tenant_idx').on(t.tenantId),
    siteWeekIdx: index('weekly_plans_site_week_idx').on(t.tenantId, t.siteId, t.weekStart),
  }),
);

export const sicEvents = pgTable(
  'sic_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id').notNull(),
    shiftId: text('shift_id'),
    mode: text('mode').notNull(),
    supervisorId: text('supervisor_id'),
    deviationCode: text('deviation_code'),
    varianceTonnes: numeric('variance_tonnes', { precision: 14, scale: 2 }),
    variancePct: numeric('variance_pct', { precision: 6, scale: 2 }),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('sic_events_tenant_idx').on(t.tenantId),
    siteIdx: index('sic_events_site_idx').on(t.tenantId, t.siteId),
    shiftIdx: index('sic_events_shift_idx').on(t.tenantId, t.shiftId),
  }),
);

export const shiftReconciliations = pgTable(
  'shift_reconciliations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id').notNull(),
    shiftId: text('shift_id').notNull(),
    reconciled: boolean('reconciled').notNull().default(false),
    discrepancy: jsonb('discrepancy').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('shift_reconciliations_tenant_idx').on(t.tenantId),
    shiftIdx: index('shift_reconciliations_shift_idx').on(t.tenantId, t.shiftId),
  }),
);

export const juniorDrillHoles = pgTable(
  'junior_drill_holes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id').notNull(),
    holeId: text('hole_id').notNull().unique(),
    kind: text('kind').notNull(),
    gps: jsonb('gps').notNull().default({}),
    azimuthDeg: numeric('azimuth_deg', { precision: 5, scale: 2 }),
    dipDeg: numeric('dip_deg', { precision: 5, scale: 2 }),
    totalDepthM: numeric('total_depth_m', { precision: 8, scale: 2 }),
    veinIntersects: integer('vein_intersects').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('junior_drill_holes_tenant_idx').on(t.tenantId),
    siteIdx: index('junior_drill_holes_site_idx').on(t.tenantId, t.siteId),
  }),
);

export const juniorDrillHoleLayers = pgTable(
  'junior_drill_hole_layers',
  {
    id: text('id').primaryKey(),
    holeId: text('hole_id').notNull(),
    idx: integer('idx').notNull(),
    depthFromM: numeric('depth_from_m', { precision: 8, scale: 2 }).notNull(),
    depthToM: numeric('depth_to_m', { precision: 8, scale: 2 }).notNull(),
    veinIntersect: boolean('vein_intersect').notNull().default(false),
    fields: jsonb('fields').notNull().default({}),
  },
  (t) => ({
    holeIdx: index('junior_drill_hole_layers_hole_idx').on(t.holeId),
  }),
);

export type LicenceDormancyScore = typeof licenceDormancyScores.$inferSelect;
export type SampleBatch = typeof sampleBatches.$inferSelect;
export type QaqcResult = typeof qaqcResults.$inferSelect;
export type GeologyScore = typeof geologyScores.$inferSelect;
export type SiteLayout = typeof siteLayouts.$inferSelect;
export type WeeklyPlan = typeof weeklyPlans.$inferSelect;
export type SicEvent = typeof sicEvents.$inferSelect;
export type ShiftReconciliation = typeof shiftReconciliations.$inferSelect;
export type JuniorDrillHole = typeof juniorDrillHoles.$inferSelect;
export type JuniorDrillHoleLayer = typeof juniorDrillHoleLayers.$inferSelect;
