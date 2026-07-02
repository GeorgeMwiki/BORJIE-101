/**
 * Opportunity-scanner backing tables — Drizzle schema (Wave OWNER-OS).
 *
 * These are the owner-state / reference tables the opportunity scanner
 * (services/api-gateway/src/services/opportunity-scanner/resolver.ts) reads
 * for the slices that CANNOT be computed from an existing base table. They are
 * created by migration 0369 and seeded with real representative mining values
 * by scripts/seed-opportunity-scanner-backing.ts.
 *
 * Every per-tenant table is FORCE-RLS on the canonical `app.current_tenant_id`
 * GUC + a service-role bypass. The two shared reference tables
 * (`nemc_amnesty_windows`, `peer_cohort_top_patterns`) are public-read /
 * service-role-write (calendar / cohort facts shared across tenants).
 *
 * Companion files:
 *   - packages/database/src/migrations/0369_opportunity_scanner_backing.sql
 *   - scripts/seed-opportunity-scanner-backing.ts
 */

import {
  pgTable,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';

export const traRoyaltyElectionState = pgTable('tra_royalty_election_state', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  nextDeadline: timestamp('next_deadline', { withTimezone: true }).notNull(),
  currentRatePct: numeric('current_rate_pct').notNull(),
  altRatePct: numeric('alt_rate_pct').notNull(),
  lastQuarterTzs: numeric('last_quarter_tzs').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const nemcAmnestyWindows = pgTable('nemc_amnesty_windows', {
  id: text('id').primaryKey(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  isOpen: boolean('is_open').notNull().default(true),
  estimatedPenaltyAvoidedTzs: numeric('estimated_penalty_avoided_tzs').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const nemcAmnestyQualifications = pgTable('nemc_amnesty_qualifications', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  amnestyId: text('amnesty_id').notNull(),
  qualifiedAt: timestamp('qualified_at', { withTimezone: true }).notNull().defaultNow(),
});

export const marketplaceBuyerOffers = pgTable('marketplace_buyer_offers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  buyerName: text('buyer_name').notNull(),
  premiumOverFixPct: numeric('premium_over_fix_pct').notNull(),
  oztEquivalent: numeric('ozt_equivalent').notNull(),
  offeredAt: timestamp('offered_at', { withTimezone: true }).notNull().defaultNow(),
});

export const marketplaceBuyers = pgTable('marketplace_buyers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  kycStatus: text('kyc_status').notNull().default('clean'),
  recentPremiumOverFixPct: numeric('recent_premium_over_fix_pct').notNull().default('0'),
  recentParcelOz: numeric('recent_parcel_oz').notNull().default('0'),
  lastSettlementAt: timestamp('last_settlement_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantLoans = pgTable('tenant_loans', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  lender: text('lender').notNull(),
  ratePct: numeric('rate_pct').notNull(),
  balanceTzs: numeric('balance_tzs').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantCashPositions = pgTable('tenant_cash_positions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  account: text('account').notNull(),
  amount: numeric('amount').notNull(),
  satDays: integer('sat_days').notNull().default(0),
  asOf: timestamp('as_of', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantEnergyProfile = pgTable('tenant_energy_profile', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  currentGridTariffTzsPerKwh: numeric('current_grid_tariff_tzs_per_kwh').notNull(),
  solarHybridTzsPerKwh: numeric('solar_hybrid_tzs_per_kwh').notNull(),
  monthlyKwhConsumption: numeric('monthly_kwh_consumption').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantOperationsProfile = pgTable('tenant_operations_profile', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  nightShiftIdleCapacityPct: numeric('night_shift_idle_capacity_pct'),
  nightShiftFuelDeltaTzsPerTonne: numeric('night_shift_fuel_delta_tzs_per_tonne'),
  bcmHaulDistanceMetresMean: numeric('bcm_haul_distance_metres_mean'),
  bcmHaulDistanceP25Metres: numeric('bcm_haul_distance_p25_metres'),
  rejectedOreTonnesRolling30d: numeric('rejected_ore_tonnes_rolling_30d'),
  downstreamProcessingTzsPerTonne: numeric('downstream_processing_tzs_per_tonne'),
  stockpileAgeP90Days: integer('stockpile_age_p90_days'),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantOperationalPatterns = pgTable('tenant_operational_patterns', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  patternLabel: text('pattern_label').notNull(),
  adoptedAt: timestamp('adopted_at', { withTimezone: true }).notNull().defaultNow(),
});

export const vendorSpendRollup = pgTable('vendor_spend_rollup', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  category: text('category').notNull(),
  vendorId: text('vendor_id').notNull(),
  annualSpendTzs: numeric('annual_spend_tzs').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workforceApprenticeshipEligibility = pgTable(
  'workforce_apprenticeship_eligibility',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    eligibleWindowEndsAt: timestamp('eligible_window_ends_at', {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const forestryCarbonEligibility = pgTable('forestry_carbon_eligibility', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  parcelRef: text('parcel_ref').notNull(),
  eligibleHectares: numeric('eligible_hectares').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const peerCohortTenantPosition = pgTable('peer_cohort_tenant_position', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  productionPercentile: integer('production_percentile').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const peerCohortTopPatterns = pgTable('peer_cohort_top_patterns', {
  id: text('id').primaryKey(),
  cohortKey: text('cohort_key').notNull(),
  p75PatternLabel: text('p75_pattern_label').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});
