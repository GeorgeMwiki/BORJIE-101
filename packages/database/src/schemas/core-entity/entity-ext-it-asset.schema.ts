/**
 * entity_ext_it_asset (migration 0193) — thin extension for IT_ASSET
 * core_entity rows.
 *
 * `assignedToEntityId` is a FK to core_entity(id), typically a PERSON
 * entity. ON DELETE SET NULL keeps the asset row when its assignee is
 * removed.
 */

import {
  pgTable,
  text,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant.schema.js';
import { coreEntity } from './core-entity.schema.js';

export const entityExtItAsset = pgTable(
  'entity_ext_it_asset',
  {
    entityId: text('entity_id')
      .primaryKey()
      .references(() => coreEntity.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assetTag: text('asset_tag'),
    /** laptop / phone / server / network_device / tablet / accessory. */
    deviceKind: text('device_kind'),
    manufacturer: text('manufacturer'),
    model: text('model'),
    purchaseDate: date('purchase_date'),
    /** FK to core_entity(id) — repository enforces type=PERSON. */
    assignedToEntityId: text('assigned_to_entity_id'),
    /** active / retired / in_repair / lost / stolen / awaiting_provisioning. */
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('entity_ext_it_asset_tenant_idx').on(t.tenantId),
    assignedIdx: index('entity_ext_it_asset_assigned_idx').on(
      t.assignedToEntityId,
    ),
    statusIdx: index('entity_ext_it_asset_status_idx').on(t.tenantId, t.status),
  }),
);

export type EntityExtItAssetRow = typeof entityExtItAsset.$inferSelect;
export type EntityExtItAssetInsert = typeof entityExtItAsset.$inferInsert;
