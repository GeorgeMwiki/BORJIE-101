/**
 * Insurance — Wave INSURANCE-BROKER.
 *
 * Companion to:
 *   - packages/database/src/migrations/0106_insurance_policies.sql
 *   - services/api-gateway/src/services/insurance-broker/
 *   - services/api-gateway/src/routes/insurance/
 *
 * Two tenant-scoped tables backing the insurance broker port:
 *   - insurance_quotes     ephemeral quote requests, valid until
 *                          `valid_until`; status flips to `bound`
 *                          when an owner selects + binds.
 *   - insurance_policies   active policies; renewal countdown surfaces
 *                          via index `insurance_policies_tenant_active`.
 *
 * The default mock provider + the optional real provider adapters
 * (Britam / NIC / Heritage) all flow through the
 * `InsuranceBrokerService` port — never write to these tables directly
 * from outside the service.
 *
 * Tenant-scoped via the canonical `app.current_tenant_id` GUC RLS
 * policy. FORCE RLS is enabled per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  numeric,
  index,
} from 'drizzle-orm/pg-core';

export const INSURANCE_COVERAGE_TYPES = [
  'workforce',
  'plant',
  'environmental',
  'third_party',
  'transit',
  'political_risk',
] as const;
export type InsuranceCoverageType =
  (typeof INSURANCE_COVERAGE_TYPES)[number];

export const INSURANCE_QUOTE_STATUSES = [
  'open',
  'bound',
  'expired',
  'declined',
] as const;
export type InsuranceQuoteStatus = (typeof INSURANCE_QUOTE_STATUSES)[number];

export const INSURANCE_POLICY_STATUSES = [
  'active',
  'cancelled',
  'expired',
  'lapsed',
] as const;
export type InsurancePolicyStatus =
  (typeof INSURANCE_POLICY_STATUSES)[number];

export const insuranceQuotes = pgTable(
  'insurance_quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    brokerPartyId: uuid('broker_party_id').notNull(),
    providerId: text('provider_id').notNull(),
    coverageType: text('coverage_type').notNull(),
    sumInsuredTzs: numeric('sum_insured_tzs', {
      precision: 18,
      scale: 2,
    }).notNull(),
    premiumTzs: numeric('premium_tzs', { precision: 18, scale: 2 }).notNull(),
    deductibleTzs: numeric('deductible_tzs', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    exclusions: jsonb('exclusions').notNull().default([]),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('open'),
    riskProfile: jsonb('risk_profile').notNull().default({}),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    auditHashId: text('audit_hash_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantStatusIdx: index('insurance_quotes_tenant_status').on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
  }),
);

export type InsuranceQuote = typeof insuranceQuotes.$inferSelect;
export type NewInsuranceQuote = typeof insuranceQuotes.$inferInsert;

export const insurancePolicies = pgTable(
  'insurance_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    brokerPartyId: uuid('broker_party_id').notNull(),
    providerId: text('provider_id').notNull(),
    quoteId: uuid('quote_id').references(() => insuranceQuotes.id, {
      onDelete: 'set null',
    }),
    policyNo: text('policy_no').notNull(),
    coverageType: text('coverage_type').notNull(),
    sumInsuredTzs: numeric('sum_insured_tzs', {
      precision: 18,
      scale: 2,
    }).notNull(),
    premiumTzs: numeric('premium_tzs', { precision: 18, scale: 2 }).notNull(),
    deductibleTzs: numeric('deductible_tzs', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    exclusions: jsonb('exclusions').notNull().default([]),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('active'),
    evidenceDocId: uuid('evidence_doc_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    auditHashId: text('audit_hash_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantActiveIdx: index('insurance_policies_tenant_active').on(
      table.tenantId,
      table.status,
      table.expiresAt,
    ),
  }),
);

export type InsurancePolicy = typeof insurancePolicies.$inferSelect;
export type NewInsurancePolicy = typeof insurancePolicies.$inferInsert;
