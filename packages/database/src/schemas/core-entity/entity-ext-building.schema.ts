/**
 * entity_ext_building (migration 0190) — thin extension for BUILDING-type
 * core_entity rows.
 */

import {
  pgTable,
  text,
  smallint,
  numeric,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant.schema.js';
import { coreEntity } from './core-entity.schema.js';

export const entityExtBuilding = pgTable(
  'entity_ext_building',
  {
    entityId: text('entity_id')
      .primaryKey()
      .references(() => coreEntity.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /**
     * warehouse / godown / hotel / office / mixed / residential.
     * Structural classification — distinct from
     * core_entity.discriminator (which is the marketing label).
     */
    buildingType: text('building_type').notNull(),
    floors: smallint('floors'),
    squareMeters: numeric('square_meters', { precision: 12, scale: 2 }),
    yearBuilt: smallint('year_built'),
    /** 1 (very poor) — 5 (excellent). */
    conditionRating: smallint('condition_rating'),
    lastInspectionAt: date('last_inspection_at'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('entity_ext_building_tenant_idx').on(t.tenantId),
    buildingTypeIdx: index('entity_ext_building_type_idx').on(
      t.tenantId,
      t.buildingType,
    ),
  }),
);

export type EntityExtBuildingRow = typeof entityExtBuilding.$inferSelect;
export type EntityExtBuildingInsert = typeof entityExtBuilding.$inferInsert;
