/**
 * Estate Entities — Wave ESTATE-OS.
 *
 * Companion to:
 *   - packages/database/src/migrations/0094_mining_estate_holdings.sql
 *   - services/api-gateway/src/routes/estate/entities.hono.ts
 *
 * Every business under the family-office shell: the mine itself, the
 * processing plant, the transport co, the fuel station, the camp
 * catering, the retail-at-site shop, the equipment-rental side hustle,
 * the real estate around the pit, JVs, agriculture, forestry, tourism.
 * `parent_entity_id` supports N-level subsidiary trees.
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS policy.
 * FORCE RLS per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  numeric,
  index,
} from 'drizzle-orm/pg-core';

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

export const ESTATE_ENTITY_STATUSES = [
  'active',
  'dormant',
  'divested',
  'wound_up',
] as const;
export type EstateEntityStatus = (typeof ESTATE_ENTITY_STATUSES)[number];

export const estateEntities = pgTable(
  'estate_entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    estateGroupId: uuid('estate_group_id').notNull(),
    /** Trading / display name. */
    name: text('name').notNull(),
    /** What kind of business this is. */
    kind: text('kind').notNull(),
    /** BRELA business-registration number. */
    brelaNo: text('brela_no'),
    /** TIN. */
    tin: text('tin'),
    /** Percentage of this entity owned by the estate (0..100). */
    ownershipPct: numeric('ownership_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('100.00'),
    /** Optional parent entity for subsidiary chains. */
    parentEntityId: uuid('parent_entity_id'),
    /** Lifecycle. */
    status: text('status').notNull().default('active'),
    foundedAt: timestamp('founded_at', { withTimezone: true }),
    divestedAt: timestamp('divested_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    groupIdx: index('idx_estate_entities_group').on(
      t.tenantId,
      t.estateGroupId,
    ),
    parentIdx: index('idx_estate_entities_parent').on(t.parentEntityId),
    kindIdx: index('idx_estate_entities_kind').on(t.tenantId, t.kind),
  }),
);

export type EstateEntityRow = typeof estateEntities.$inferSelect;
export type EstateEntityInsert = typeof estateEntities.$inferInsert;
