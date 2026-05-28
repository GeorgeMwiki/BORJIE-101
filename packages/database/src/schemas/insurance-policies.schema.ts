/**
 * Insurance Policies & Quotes Schema (migration 0106)
 *
 * Stores insurance broker integration artifacts: quote requests and bound
 * policies. Tenant-scoped with RLS FORCE-enabled. Hash-chained audit trail
 * on every state change. Integrates with the broker port abstraction in
 * services/api-gateway/src/services/insurance-broker.
 *
 * Tables:
 *   - insurance_quotes:  Quote requests to providers
 *   - insurance_policies: Bound policies (active + historical)
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

const COVERAGE_TYPES = [
  'workforce',
  'plant',
  'environmental',
  'third_party',
  'transit',
  'political_risk',
] as const;

const QUOTE_STATUSES = ['open', 'bound', 'expired', 'declined'] as const;
const POLICY_STATUSES = ['active', 'cancelled', 'expired', 'lapsed'] as const;

// ---------------------------------------------------------------------------
// insurance_quotes
// ---------------------------------------------------------------------------

export const insuranceQuotes = pgTable(
  'insurance_quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    brokerPartyId: uuid('broker_party_id').notNull(),
    providerId: text('provider_id').notNull(),
    coverageType: text('coverage_type').notNull(),
    sumInsuredTzs: numeric('sum_insured_tzs', { precision: 18, scale: 2 }).notNull(),
    premiumTzs: numeric('premium_tzs', { precision: 18, scale: 2 }).notNull(),
    deductibleTzs: numeric('deductible_tzs', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    exclusions: jsonb('exclusions').notNull().default('[]'),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('open'),
    riskProfile: jsonb('risk_profile').notNull().default('{}'),
    provenance: jsonb('provenance').notNull().default('{"via":"unknown"}'),
    auditHashId: text('audit_hash_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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

// ---------------------------------------------------------------------------
// insurance_policies
// ---------------------------------------------------------------------------

export const insurancePolicies = pgTable(
  'insurance_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    brokerPartyId: uuid('broker_party_id').notNull(),
    providerId: text('provider_id').notNull(),
    quoteId: uuid('quote_id').references(() => insuranceQuotes.id, { onDelete: 'setNull' }),
    policyNo: text('policy_no').notNull(),
    coverageType: text('coverage_type').notNull(),
    sumInsuredTzs: numeric('sum_insured_tzs', { precision: 18, scale: 2 }).notNull(),
    premiumTzs: numeric('premium_tzs', { precision: 18, scale: 2 }).notNull(),
    deductibleTzs: numeric('deductible_tzs', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    exclusions: jsonb('exclusions').notNull().default('[]'),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('active'),
    evidenceDocId: uuid('evidence_doc_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    provenance: jsonb('provenance').notNull().default('{"via":"unknown"}'),
    auditHashId: text('audit_hash_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
