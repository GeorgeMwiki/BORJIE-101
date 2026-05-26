/**
 * Workforce + safety + community + risk junior outputs — HR summaries,
 * safety snapshots, grievance records, metallurgy recommendations,
 * risk snapshots, forecast snapshots, junior CSR plans.
 *
 * Split out of `./commercial.ts` to keep every junior-outputs file
 * under the 300-line ceiling.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  integer,
  jsonb,
  index,
  tenants,
} from './_shared.js';

export const hrSummaries = pgTable(
  'hr_summaries',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reportingMonth: text('reporting_month').notNull(),
    summary: jsonb('summary').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('hr_summaries_tenant_idx').on(t.tenantId),
    monthIdx: index('hr_summaries_month_idx').on(t.tenantId, t.reportingMonth),
  }),
);

export const safetySnapshots = pgTable(
  'safety_snapshots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id'),
    ppeCompliancePct: numeric('ppe_compliance_pct', { precision: 5, scale: 2 }),
    summary: jsonb('summary').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('safety_snapshots_tenant_idx').on(t.tenantId),
    siteIdx: index('safety_snapshots_site_idx').on(t.tenantId, t.siteId),
  }),
);

export const grievanceRecords = pgTable(
  'grievance_records',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    summary: jsonb('summary').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('grievance_records_tenant_idx').on(t.tenantId),
  }),
);

export const metallurgyRecommendations = pgTable(
  'metallurgy_recommendations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id'),
    mineralFamily: text('mineral_family').notNull(),
    expectedRecoveryPct: numeric('expected_recovery_pct', { precision: 5, scale: 2 }),
    summary: jsonb('summary').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('metallurgy_recommendations_tenant_idx').on(t.tenantId),
    mineralIdx: index('metallurgy_recommendations_mineral_idx').on(
      t.tenantId,
      t.mineralFamily,
    ),
  }),
);

export const riskSnapshots = pgTable(
  'risk_snapshots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id'),
    compositeScore: numeric('composite_score', { precision: 5, scale: 2 }),
    band: text('band'),
    summary: jsonb('summary').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('risk_snapshots_tenant_idx').on(t.tenantId),
    bandIdx: index('risk_snapshots_band_idx').on(t.tenantId, t.band),
  }),
);

export const forecastSnapshots = pgTable(
  'forecast_snapshots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id'),
    kind: text('kind').notNull(),
    horizonDays: integer('horizon_days').notNull(),
    summary: jsonb('summary').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('forecast_snapshots_tenant_idx').on(t.tenantId),
    kindIdx: index('forecast_snapshots_kind_idx').on(t.tenantId, t.kind),
  }),
);

export const juniorCsrPlans = pgTable(
  'junior_csr_plans',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    licenceId: text('licence_id'),
    status: text('status').notNull(),
    deliveredPct: numeric('delivered_pct', { precision: 5, scale: 2 }),
    summary: jsonb('summary').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('junior_csr_plans_tenant_idx').on(t.tenantId),
    licenceIdx: index('junior_csr_plans_licence_idx').on(t.tenantId, t.licenceId),
  }),
);

export type HrSummary = typeof hrSummaries.$inferSelect;
export type SafetySnapshot = typeof safetySnapshots.$inferSelect;
export type GrievanceRecord = typeof grievanceRecords.$inferSelect;
export type MetallurgyRecommendation = typeof metallurgyRecommendations.$inferSelect;
export type RiskSnapshot = typeof riskSnapshots.$inferSelect;
export type ForecastSnapshot = typeof forecastSnapshots.$inferSelect;
export type JuniorCsrPlan = typeof juniorCsrPlans.$inferSelect;
