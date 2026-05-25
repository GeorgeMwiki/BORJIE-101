/**
 * entity_ext_land (migration 0189) — thin extension for LAND_PARCEL /
 * PLOT / BARELAND / WAREHOUSE / GODOWN core_entity rows.
 */

import {
  pgTable,
  text,
  boolean,
  numeric,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant.schema.js';
import { coreEntity } from './core-entity.schema.js';

export const entityExtLand = pgTable(
  'entity_ext_land',
  {
    entityId: text('entity_id')
      .primaryKey()
      .references(() => coreEntity.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    plotNumber: text('plot_number'),
    hectares: numeric('hectares', { precision: 12, scale: 4 }),
    /**
     * Portion of the parent parcel covered by this child. 0.5 = half.
     * NULL for top-level parcels.
     */
    fractionalArea: numeric('fractional_area', { precision: 6, scale: 4 }),
    /**
     * Generic zoning-conflict flag. Originally named after the Tanzania
     * Railways reserve pilot use case; useful for any protected /
     * easement / conservation area.
     */
    inRailwayReserve: boolean('in_railway_reserve').notNull().default(false),
    zoning: text('zoning'),
    /** residential / commercial / industrial / mixed / undeveloped */
    landUse: text('land_use'),
    titleDeedRef: text('title_deed_ref'),
    surveyedAt: date('surveyed_at'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('entity_ext_land_tenant_idx').on(t.tenantId),
    zoningIdx: index('entity_ext_land_zoning_idx').on(t.tenantId, t.zoning),
  }),
);

export type EntityExtLandRow = typeof entityExtLand.$inferSelect;
export type EntityExtLandInsert = typeof entityExtLand.$inferInsert;
