/**
 * entity_ext_vehicle (migration 0191) — thin extension for VEHICLE /
 * LOCOMOTIVE core_entity rows.
 */

import {
  pgTable,
  text,
  smallint,
  integer,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant.schema.js';
import { coreEntity } from './core-entity.schema.js';

export const entityExtVehicle = pgTable(
  'entity_ext_vehicle',
  {
    entityId: text('entity_id')
      .primaryKey()
      .references(() => coreEntity.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    vin: text('vin'),
    licensePlate: text('license_plate'),
    make: text('make'),
    model: text('model'),
    yearManufactured: smallint('year_manufactured'),
    fuelType: text('fuel_type'),
    odometerKm: integer('odometer_km'),
    /** active / maintenance / retired / sold / impounded. */
    status: text('status').notNull().default('active'),
    lastServiceAt: date('last_service_at'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('entity_ext_vehicle_tenant_idx').on(t.tenantId),
    statusIdx: index('entity_ext_vehicle_status_idx').on(t.tenantId, t.status),
  }),
);

export type EntityExtVehicleRow = typeof entityExtVehicle.$inferSelect;
export type EntityExtVehicleInsert = typeof entityExtVehicle.$inferInsert;
