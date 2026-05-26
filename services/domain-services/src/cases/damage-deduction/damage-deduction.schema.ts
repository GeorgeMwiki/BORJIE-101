/**
 * Drizzle schema for damage_deduction_cases.
 *
 * Mirrors migration 0017. Spec: MISSING_FEATURES_DESIGN.md §8.
 */

import { pgTable, text, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const damageDeductionCases = pgTable(
  'damage_deduction_cases',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    leaseId: text('lease_id'),
    caseId: text('case_id'),
    moveOutInspectionId: text('move_out_inspection_id'),

    claimedDeductionMinor: integer('claimed_deduction_minor').notNull().default(0),
    proposedDeductionMinor: integer('proposed_deduction_minor'),
    tenantCounterProposalMinor: integer('tenant_counter_proposal_minor'),
    // Currency should be supplied by the service layer from
    // `tenant.defaultCurrency` (see @borjie/domain-models
    // `getDefaultCurrency(tenant.countryCode)`). The stored default below
    // matches migration 0017_cases_sla_and_subleases.sql and exists only
    // for rows created before tenant context is available.
    //
    // UNIV-4: column default = TZ launch beachhead; future jurisdictions write
    // their own value. See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
    currency: text('currency').notNull().default('TZS'),

    status: text('status').notNull().default('claim_filed'),

    evidenceBundleId: text('evidence_bundle_id'),
    aiMediatorTurns: jsonb('ai_mediator_turns').notNull().default([]),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
  },
  (t) => ({
    tenantIdx: index('damage_deduction_cases_tenant_idx').on(t.tenantId),
    leaseIdx: index('damage_deduction_cases_lease_idx').on(t.leaseId),
    caseIdx: index('damage_deduction_cases_case_idx').on(t.caseId),
    statusIdx: index('damage_deduction_cases_status_idx').on(t.status),
  })
);
