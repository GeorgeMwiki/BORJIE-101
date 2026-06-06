/**
 * stage_advisor_* (migration 0295) — `@borjie/stage-advisor` durable store.
 *
 * Six tenant-scoped tables back the package's `StageAdvisorDb` port so the
 * stage-aware capability advisor (seven lifecycle stages, hysteresis,
 * playbooks, capability gating, proactive nudges) runs on REAL persisted rows
 * instead of the in-memory dev store:
 *
 *   - stage_advisor_metrics          — latest org-metrics snapshot per tenant
 *     (getMetrics). Primary axis `unitsManaged` + secondaries.
 *   - stage_advisor_org_state        — latest operational-state snapshot per
 *     tenant (getOrgState); drives playbook task-completion predicates.
 *   - stage_advisor_state            — persisted hysteresis state per tenant
 *     (getPersistedState / savePersistedState).
 *   - stage_advisor_nudges           — APPEND-ONLY nudge-delivery log per tenant
 *     (getNudgeHistory / recordNudgeDelivery) backing lookback idempotency.
 *   - stage_advisor_nudge_dismissals — sticky per-(tenant,nudge) suppression
 *     (isNudgeDismissed / dismissNudge).
 *   - stage_advisor_transitions      — APPEND-ONLY transition history per tenant
 *     (getTransitionHistory / appendTransition) backing GET /history.
 *
 * Tenant scope (CLAUDE.md hard rule — mirrors migrations 0292 / 0294): every
 * tenant_id is TEXT and FK→tenants; all six tables FORCE-enable RLS on the
 * canonical `app.current_tenant_id` GUC. The Drizzle adapter also filters every
 * read by tenantId for defence-in-depth.
 *
 * Currency neutrality (CLAUDE.md hard rule): the only money column is
 * `monthlyRevenueCents` — an INTEGER minor-units figure carried alongside a
 * free-text `currency` code. No currency literal anywhere.
 *
 * Companion to:
 *   - packages/database/src/migrations/0295_stage_advisor.sql
 *   - services/api-gateway/src/composition/stage/drizzle-stage-advisor-db.ts
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  jsonb,
  uuid,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const stageAdvisorMetrics = pgTable('stage_advisor_metrics', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** Primary axis — total units the org manages. */
  unitsManaged: integer('units_managed').notNull().default(0),
  activeUsers: integer('active_users').notNull().default(0),
  /** Monthly revenue in INTEGER minor-units of the tenant currency. */
  monthlyRevenueCents: integer('monthly_revenue_cents').notNull().default(0),
  /** ISO-4217 reporting currency (resolved per-tenant; no literal in code). */
  currency: text('currency').notNull().default('TZS'),
  ageMonths: integer('age_months').notNull().default(0),
  regionCount: integer('region_count').notNull().default(0),
  /** Rolling 90d churn rate (0-1). */
  tenantChurnRate: doublePrecision('tenant_churn_rate').notNull().default(0),
  observedAt: timestamp('observed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const stageAdvisorOrgState = pgTable('stage_advisor_org_state', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  orgSetupComplete: boolean('org_setup_complete').notNull().default(false),
  propertyCount: integer('property_count').notNull().default(0),
  unitsManaged: integer('units_managed').notNull().default(0),
  leaseCount: integer('lease_count').notNull().default(0),
  paymentMethodsConfigured: integer('payment_methods_configured')
    .notNull()
    .default(0),
  maintenanceCategoriesDefined: integer('maintenance_categories_defined')
    .notNull()
    .default(0),
  scheduledInspectionsConfigured: integer('scheduled_inspections_configured')
    .notNull()
    .default(0),
  vendorCount: integer('vendor_count').notNull().default(0),
  inventoryLocationsCount: integer('inventory_locations_count')
    .notNull()
    .default(0),
  rfqCount: integer('rfq_count').notNull().default(0),
  fleetVehicleCount: integer('fleet_vehicle_count').notNull().default(0),
  reportCadenceCount: integer('report_cadence_count').notNull().default(0),
  regionsConfigured: integer('regions_configured').notNull().default(0),
  treasuryAccountCount: integer('treasury_account_count').notNull().default(0),
  jurisdictionsConfigured: integer('jurisdictions_configured')
    .notNull()
    .default(0),
  /** Extension bag for extra named signals (string|number|boolean values). */
  extra: jsonb('extra').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const stageAdvisorState = pgTable('stage_advisor_state', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** pre-launch|seedling|sprout|sapling|tree|forest|ecosystem. */
  currentStage: text('current_stage').notNull(),
  currentStageSince: timestamp('current_stage_since', {
    withTimezone: true,
  }).notNull(),
  /** Candidate stage under observation (NULL when none pending). */
  candidateStage: text('candidate_stage'),
  candidateStageSince: timestamp('candidate_stage_since', {
    withTimezone: true,
  }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const stageAdvisorNudges = pgTable(
  'stage_advisor_nudges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Stable nudge id (`stage-nudge:<tenant>:<topic>`). */
    nudgeId: text('nudge_id').notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('stage_advisor_nudges_tenant_idx').on(t.tenantId),
    tenantNudgeIdx: index('stage_advisor_nudges_tenant_nudge_idx').on(
      t.tenantId,
      t.nudgeId,
    ),
    tenantDeliveredIdx: index('stage_advisor_nudges_tenant_delivered_idx').on(
      t.tenantId,
      t.deliveredAt,
    ),
  }),
);

export const stageAdvisorNudgeDismissals = pgTable(
  'stage_advisor_nudge_dismissals',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    nudgeId: text('nudge_id').notNull(),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.nudgeId] }),
  }),
);

export const stageAdvisorTransitions = pgTable(
  'stage_advisor_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    fromStage: text('from_stage').notNull(),
    toStage: text('to_stage').notNull(),
    /** grow|shrink|same. */
    kind: text('kind').notNull(),
    introductionMessage: text('introduction_message').notNull().default(''),
    recommendedNextSteps: text('recommended_next_steps')
      .array()
      .notNull()
      .default([]),
    capabilitiesToUnlock: text('capabilities_to_unlock')
      .array()
      .notNull()
      .default([]),
    capabilitiesToReview: text('capabilities_to_review')
      .array()
      .notNull()
      .default([]),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('stage_advisor_transitions_tenant_idx').on(t.tenantId),
    tenantOccurredIdx: index(
      'stage_advisor_transitions_tenant_occurred_idx',
    ).on(t.tenantId, t.occurredAt),
  }),
);

export type StageAdvisorMetricsRow = typeof stageAdvisorMetrics.$inferSelect;
export type StageAdvisorOrgStateRow = typeof stageAdvisorOrgState.$inferSelect;
export type StageAdvisorStateRow = typeof stageAdvisorState.$inferSelect;
export type StageAdvisorNudgeRow = typeof stageAdvisorNudges.$inferSelect;
export type StageAdvisorNudgeDismissalRow =
  typeof stageAdvisorNudgeDismissals.$inferSelect;
export type StageAdvisorTransitionRow =
  typeof stageAdvisorTransitions.$inferSelect;
