/**
 * Site damage settlement + mine rehabilitation — Borjie mining domain
 * (migration 0279).
 *
 * Ported from the BossNyumba dispute / damage-deduction + conditional-survey
 * stack, retargeted real-estate → mining:
 *
 *   - `contractor_damage_claims`    RE tenant damage deduction → mining
 *                                   contractor / site damage claim. The
 *                                   licence holder files a claim against a
 *                                   contractor for damage to a site,
 *                                   negotiates (respond), then settles
 *                                   (settle) at an agreed amount recorded as
 *                                   STATE. NO ledger posting fires here.
 *   - `site_rehabilitation_plans`   RE conditional survey → mining
 *                                   rehabilitation plan.
 *   - `rehabilitation_action_plans` RE conditional-survey action plan →
 *                                   mining rehabilitation action plan.
 *                                   Approving one unblocks work-order
 *                                   dispatch.
 *
 * Currency neutrality (CLAUDE.md hard rule): amounts are MINOR-unit `bigint`
 * columns paired with an explicit 3-letter `currency` code. There is NO
 * default currency — callers resolve the tenant currency before insert.
 *
 * RLS: tenant-scoped FORCE RLS on the canonical `app.current_tenant_id` GUC
 * (the GUC the api-gateway databaseMiddleware binds). NEVER the legacy
 * `app.tenant_id`.
 *
 * Companion files:
 *   - packages/database/src/migrations/0279_site_damage_settlement.sql
 *   - services/api-gateway/src/routes/damage-claims.hono.ts
 *   - services/api-gateway/src/composition/damage-claim-repository.ts
 *   - services/api-gateway/src/composition/brain-tools/
 *     damage-settlement-tools.ts
 */

import {
  pgTable,
  text,
  bigint,
  timestamp,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { sites } from './sites.schema.js';
import { externalParties } from './external-parties.schema.js';

// ============================================================================
// Shared enum-like literal unions (column-level contracts shared by the
// schema, route, and brain tools). Postgres CHECK constraints enforce them.
// ============================================================================

export const DAMAGE_CLAIM_STATUSES = [
  'claim_filed',
  'negotiating',
  'agreed',
  'withdrawn',
] as const;
export type DamageClaimStatus = (typeof DAMAGE_CLAIM_STATUSES)[number];

export const DAMAGE_CATEGORIES = [
  'equipment',
  'haul_road',
  'env_buffer',
  'water_source',
  'processing_plant',
  'camp',
  'other',
] as const;
export type DamageCategory = (typeof DAMAGE_CATEGORIES)[number];

export const REHABILITATION_PLAN_STATUSES = [
  'draft',
  'in_review',
  'compiled',
  'closed',
] as const;
export type RehabilitationPlanStatus =
  (typeof REHABILITATION_PLAN_STATUSES)[number];

export const REHABILITATION_PLAN_SCOPES = [
  'backfill',
  're_vegetation',
  'water_treatment',
  'slope_stabilisation',
  'waste_dump_capping',
  'general',
] as const;
export type RehabilitationPlanScope =
  (typeof REHABILITATION_PLAN_SCOPES)[number];

export const REHABILITATION_ACTION_STATUSES = [
  'proposed',
  'approved',
  'rejected',
  'dispatched',
] as const;
export type RehabilitationActionStatus =
  (typeof REHABILITATION_ACTION_STATUSES)[number];

export const REHABILITATION_ACTION_SEVERITIES = [
  'low',
  'medium',
  'high',
  'critical',
] as const;
export type RehabilitationActionSeverity =
  (typeof REHABILITATION_ACTION_SEVERITIES)[number];

// ============================================================================
// contractor_damage_claims — RE tenant damage deduction → mining contractor /
// site damage claim.
// ============================================================================

export const contractorDamageClaims = pgTable(
  'contractor_damage_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Site the damage occurred at (hard FK). */
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** Contractor / counterparty the claim is against (hard FK). */
    contractorPartyId: uuid('contractor_party_id')
      .notNull()
      .references(() => externalParties.id, { onDelete: 'cascade' }),
    /** Optional link to the engagement / inspection that surfaced the damage. */
    sourceEngagementId: uuid('source_engagement_id'),
    /** equipment | haul_road | env_buffer | water_source | processing_plant | camp | other. */
    damageCategory: text('damage_category').notNull().default('other'),
    /** Amounts in MINOR units; `currency` is explicit (no default). */
    claimedAmountMinor: bigint('claimed_amount_minor', {
      mode: 'number',
    }).notNull(),
    counterProposalMinor: bigint('counter_proposal_minor', { mode: 'number' }),
    agreedAmountMinor: bigint('agreed_amount_minor', { mode: 'number' }),
    currency: text('currency').notNull(),
    /** claim_filed -> negotiating -> agreed | withdrawn. */
    status: text('status').notNull().default('claim_filed'),
    rationale: text('rationale').notNull(),
    notes: text('notes'),
    /** Append-only negotiation turns. */
    negotiationTurns: jsonb('negotiation_turns').notNull().default([]),
    /** Provenance envelope — shape-stable with withChatProvenance. */
    provenance: jsonb('provenance').notNull().default({}),
    /** Soft reference to ai_audit_chain ids. */
    auditChainIds: jsonb('audit_chain_ids').notNull().default([]),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('cdc_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    siteIdx: index('cdc_site_idx').on(t.siteId),
    contractorIdx: index('cdc_contractor_idx').on(t.contractorPartyId),
  }),
);

export type ContractorDamageClaim =
  typeof contractorDamageClaims.$inferSelect;
export type NewContractorDamageClaim =
  typeof contractorDamageClaims.$inferInsert;

// ============================================================================
// site_rehabilitation_plans — RE conditional survey → mining rehabilitation
// plan.
// ============================================================================

export const siteRehabilitationPlans = pgTable(
  'site_rehabilitation_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary'),
    /** backfill | re_vegetation | water_treatment | slope_stabilisation | waste_dump_capping | general. */
    scope: text('scope').notNull().default('general'),
    /** draft -> in_review -> compiled -> closed. */
    status: text('status').notNull().default('draft'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    provenance: jsonb('provenance').notNull().default({}),
    auditChainIds: jsonb('audit_chain_ids').notNull().default([]),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('srp_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    siteIdx: index('srp_site_idx').on(t.siteId),
  }),
);

export type SiteRehabilitationPlan =
  typeof siteRehabilitationPlans.$inferSelect;
export type NewSiteRehabilitationPlan =
  typeof siteRehabilitationPlans.$inferInsert;

// ============================================================================
// rehabilitation_action_plans — RE conditional-survey action plan → mining
// rehabilitation action plan.
// ============================================================================

export const rehabilitationActionPlans = pgTable(
  'rehabilitation_action_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    rehabilitationPlanId: uuid('rehabilitation_plan_id')
      .notNull()
      .references(() => siteRehabilitationPlans.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    /** low | medium | high | critical. */
    severity: text('severity').notNull().default('medium'),
    /** Estimated remediation cost in MINOR units; currency explicit, nullable. */
    estimatedCostMinor: bigint('estimated_cost_minor', { mode: 'number' }),
    currency: text('currency'),
    /** proposed -> approved -> rejected -> dispatched. */
    status: text('status').notNull().default('proposed'),
    approvedBy: text('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    provenance: jsonb('provenance').notNull().default({}),
    auditChainIds: jsonb('audit_chain_ids').notNull().default([]),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    planIdx: index('rap_plan_idx').on(t.rehabilitationPlanId),
    tenantStatusIdx: index('rap_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
  }),
);

export type RehabilitationActionPlan =
  typeof rehabilitationActionPlans.$inferSelect;
export type NewRehabilitationActionPlan =
  typeof rehabilitationActionPlans.$inferInsert;
