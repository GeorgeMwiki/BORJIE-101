/**
 * entity_ext_machinery (migration 0192) — thin extension for MACHINERY
 * core_entity rows.
 */

import {
  pgTable,
  text,
  integer,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant.schema.js';
import { coreEntity } from './core-entity.schema.js';

export const entityExtMachinery = pgTable(
  'entity_ext_machinery',
  {
    entityId: text('entity_id')
      .primaryKey()
      .references(() => coreEntity.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serialNumber: text('serial_number'),
    manufacturer: text('manufacturer'),
    model: text('model'),
    installationDate: date('installation_date'),
    warrantyExpires: date('warranty_expires'),
    lastInspectionAt: date('last_inspection_at'),
    hoursRun: integer('hours_run'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('entity_ext_machinery_tenant_idx').on(t.tenantId),
    manufacturerIdx: index('entity_ext_machinery_manufacturer_idx').on(
      t.tenantId,
      t.manufacturer,
    ),
  }),
);

export type EntityExtMachineryRow = typeof entityExtMachinery.$inferSelect;
export type EntityExtMachineryInsert = typeof entityExtMachinery.$inferInsert;
