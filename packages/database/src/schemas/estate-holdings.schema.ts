/**
 * Estate holdings — Wave ESTATE-OS.
 *
 * Five Drizzle tables modelling the family-office layer of a mining-
 * rooted business empire:
 *
 *   estate_groups            top-level holding registry
 *   estate_entities          subsidiaries / JVs / standalone holdings
 *   estate_capital_movements view-layer ledger of intercompany flows
 *   succession_plans         successor designation + review cadence
 *   estate_assets            asset register per entity
 *
 * Companion to:
 *   - packages/database/src/migrations/0094_mining_estate_holdings.sql
 *   - services/api-gateway/src/routes/estate/*.hono.ts
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  date,
  uuid,
  numeric,
  integer,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// estate_groups — top-level family-office groups
// ============================================================================

export const estateGroups = pgTable(
  'estate_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    /** family_trust | family_office | holding_company | cooperative |
     *  investment_vehicle | other. */
    holdingType: text('holding_type').notNull(),
    country: text('country').notNull().default('TZ'),
    principalOwnerName: text('principal_owner_name').notNull(),
    principalOwnerNida: text('principal_owner_nida'),
    principalOwnerTin: text('principal_owner_tin'),
    foundingYear: integer('founding_year'),
    successionDocId: text('succession_doc_id'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('idx_estate_groups_tenant_created').on(
      t.tenantId,
      t.createdAt,
    ),
  }),
);

export type EstateGroup = typeof estateGroups.$inferSelect;
export type NewEstateGroup = typeof estateGroups.$inferInsert;

export const ESTATE_GROUP_HOLDING_TYPES = [
  'family_trust',
  'family_office',
  'holding_company',
  'cooperative',
  'investment_vehicle',
  'other',
] as const;
export type EstateGroupHoldingType =
  (typeof ESTATE_GROUP_HOLDING_TYPES)[number];

// ============================================================================
// estate_entities — subsidiaries / JVs / standalone holdings
// ============================================================================

export const estateEntities = pgTable(
  'estate_entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    estateGroupId: uuid('estate_group_id').notNull(),
    name: text('name').notNull(),
    /** mine_licence_holder | processing_plant | transport_co |
     *  equipment_rental | camp_catering | fuel_station | retail_at_site |
     *  real_estate | agriculture | forestry | tourism | security_co |
     *  insurance_brokerage | consulting_firm | training_school |
     *  subsidiary_holding | joint_venture | other. */
    kind: text('kind').notNull(),
    brelaNo: text('brela_no'),
    tin: text('tin'),
    ownershipPct: numeric('ownership_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('100'),
    parentEntityId: uuid('parent_entity_id'),
    status: text('status').notNull().default('active'),
    foundedAt: date('founded_at'),
    divestedAt: date('divested_at'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantGroupIdx: index('idx_estate_entities_tenant_group').on(
      t.tenantId,
      t.estateGroupId,
      t.status,
    ),
    parentIdx: index('idx_estate_entities_parent').on(t.parentEntityId),
  }),
);

export type EstateEntity = typeof estateEntities.$inferSelect;
export type NewEstateEntity = typeof estateEntities.$inferInsert;

export const ESTATE_ENTITY_KINDS = [
  'mine_licence_holder',
  'processing_plant',
  'transport_co',
  'equipment_rental',
  'camp_catering',
  'fuel_station',
  'retail_at_site',
  'real_estate',
  'agriculture',
  'forestry',
  'tourism',
  'security_co',
  'insurance_brokerage',
  'consulting_firm',
  'training_school',
  'subsidiary_holding',
  'joint_venture',
  'other',
] as const;
export type EstateEntityKind = (typeof ESTATE_ENTITY_KINDS)[number];

// ============================================================================
// estate_capital_movements — VIEW LAYER over LedgerService
// ============================================================================

export const estateCapitalMovements = pgTable(
  'estate_capital_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    fromEntityId: uuid('from_entity_id'),
    toEntityId: uuid('to_entity_id'),
    /** capital_injection | dividend | loan | loan_repayment | transfer |
     *  expense_reimbursement | asset_purchase | asset_sale | royalty | other. */
    kind: text('kind').notNull(),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('TZS'),
    happenedAt: timestamp('happened_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    narrative: text('narrative'),
    docLinkId: text('doc_link_id'),
    ledgerEntryId: text('ledger_entry_id'),
    auditHashId: uuid('audit_hash_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantHappenedIdx: index('idx_ecm_tenant_happened').on(
      t.tenantId,
      t.happenedAt,
    ),
    fromIdx: index('idx_ecm_from_entity').on(
      t.tenantId,
      t.fromEntityId,
      t.happenedAt,
    ),
    toIdx: index('idx_ecm_to_entity').on(
      t.tenantId,
      t.toEntityId,
      t.happenedAt,
    ),
  }),
);

export type EstateCapitalMovement =
  typeof estateCapitalMovements.$inferSelect;
export type NewEstateCapitalMovement =
  typeof estateCapitalMovements.$inferInsert;

export const ESTATE_CAPITAL_KINDS = [
  'capital_injection',
  'dividend',
  'loan',
  'loan_repayment',
  'transfer',
  'expense_reimbursement',
  'asset_purchase',
  'asset_sale',
  'royalty',
  'other',
] as const;
export type EstateCapitalKind = (typeof ESTATE_CAPITAL_KINDS)[number];

// ============================================================================
// succession_plans — successor designation + review cadence
// ============================================================================

export const successionPlans = pgTable(
  'succession_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    estateGroupId: uuid('estate_group_id').notNull(),
    currentPrincipalName: text('current_principal_name').notNull(),
    designatedSuccessorName: text('designated_successor_name').notNull(),
    designatedSuccessorRelation: text(
      'designated_successor_relation',
    ).notNull(),
    designatedSuccessorNida: text('designated_successor_nida'),
    contingencySuccessorName: text('contingency_successor_name'),
    willDocId: text('will_doc_id'),
    lastReviewAt: timestamp('last_review_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    nextReviewDueAt: timestamp('next_review_due_at', {
      withTimezone: true,
    }).notNull(),
    status: text('status').notNull().default('current'),
    notes: text('notes'),
    auditHashId: uuid('audit_hash_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantGroupIdx: index('idx_sp_tenant_group').on(
      t.tenantId,
      t.estateGroupId,
    ),
    nextReviewIdx: index('idx_sp_next_review').on(
      t.tenantId,
      t.nextReviewDueAt,
    ),
  }),
);

export type SuccessionPlan = typeof successionPlans.$inferSelect;
export type NewSuccessionPlan = typeof successionPlans.$inferInsert;

export const SUCCESSION_PLAN_STATUSES = [
  'current',
  'pending_review',
  'overdue',
  'archived',
] as const;
export type SuccessionPlanStatus =
  (typeof SUCCESSION_PLAN_STATUSES)[number];

// ============================================================================
// estate_assets — asset register per entity
// ============================================================================

export const estateAssets = pgTable(
  'estate_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    estateEntityId: uuid('estate_entity_id').notNull(),
    /** mining_equipment | vehicle | real_estate | building |
     *  mineral_inventory | financial_instrument | land |
     *  intellectual_property | cash_equivalent | investment | other. */
    assetClass: text('asset_class').notNull(),
    descriptor: text('descriptor').notNull(),
    acquiredAt: date('acquired_at'),
    acquiredCostTzs: numeric('acquired_cost_tzs', {
      precision: 18,
      scale: 2,
    }),
    currentValueTzs: numeric('current_value_tzs', {
      precision: 18,
      scale: 2,
    })
      .notNull()
      .default('0'),
    /** book_value | market_value | replacement_cost | appraised |
     *  discounted_cash_flow | other. */
    valuationMethod: text('valuation_method').notNull().default('book_value'),
    valuationAt: timestamp('valuation_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    location: text('location'),
    insuredUntil: date('insured_until'),
    encumbrances: jsonb('encumbrances').notNull().default([]),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantEntityIdx: index('idx_estate_assets_tenant_entity').on(
      t.tenantId,
      t.estateEntityId,
      t.assetClass,
    ),
  }),
);

export type EstateAsset = typeof estateAssets.$inferSelect;
export type NewEstateAsset = typeof estateAssets.$inferInsert;

export const ESTATE_ASSET_CLASSES = [
  'mining_equipment',
  'vehicle',
  'real_estate',
  'building',
  'mineral_inventory',
  'financial_instrument',
  'land',
  'intellectual_property',
  'cash_equivalent',
  'investment',
  'other',
] as const;
export type EstateAssetClass = (typeof ESTATE_ASSET_CLASSES)[number];

export const ESTATE_VALUATION_METHODS = [
  'book_value',
  'market_value',
  'replacement_cost',
  'appraised',
  'discounted_cash_flow',
  'other',
] as const;
export type EstateValuationMethod =
  (typeof ESTATE_VALUATION_METHODS)[number];
