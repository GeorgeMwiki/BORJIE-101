/**
 * Cross-schema Drizzle relations for the Borjie mining domain.
 *
 * Drizzle's `relations()` declarations live OUTSIDE each table file so a
 * table can participate in many relation graphs without creating
 * circular imports. Per-table single-direction relations may still live
 * next to the table — this module wires the cross-cutting ones the rest
 * of the codebase needs for type-safe joins:
 *
 *   - `licences` → `tenants`        (many-to-one)
 *   - `licences` → `companies`      (many-to-one)
 *   - `licences` → `licenceEvents`  (one-to-many)
 *   - `licenceEvents` → `licences`  (many-to-one)
 *   - `temporalEntities` ↔ `temporalEntities` via `temporalRelationships`
 *     (many-to-many through edge table)
 *
 * Re-exported via `schemas/index.ts` so `drizzle()` discovers them when
 * the client filters its schema map.
 */

import { relations } from 'drizzle-orm';
import { tenants, users } from './tenant.schema.js';
import { companies } from './companies.schema.js';
import { licences, licenceEvents } from './licences.schema.js';
import {
  temporalEntities,
  temporalRelationships,
} from './temporal-entity-graph.schema.js';

// ============================================================================
// Licences ⇄ tenants / companies / users / licence-events
// ============================================================================

export const licencesRelations = relations(licences, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [licences.tenantId],
    references: [tenants.id],
  }),
  company: one(companies, {
    fields: [licences.companyId],
    references: [companies.id],
  }),
  holder: one(users, {
    fields: [licences.holderUserId],
    references: [users.id],
  }),
  events: many(licenceEvents),
}));

export const licenceEventsRelations = relations(licenceEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [licenceEvents.tenantId],
    references: [tenants.id],
  }),
  licence: one(licences, {
    fields: [licenceEvents.licenceId],
    references: [licences.id],
  }),
}));

// ============================================================================
// Temporal entity graph — self-referential many-to-many via edges
// ============================================================================

export const temporalEntitiesRelations = relations(
  temporalEntities,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [temporalEntities.tenantId],
      references: [tenants.id],
    }),
    outgoing: many(temporalRelationships, { relationName: 'fromEntity' }),
    incoming: many(temporalRelationships, { relationName: 'toEntity' }),
  }),
);

export const temporalRelationshipsRelations = relations(
  temporalRelationships,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [temporalRelationships.tenantId],
      references: [tenants.id],
    }),
    fromEntity: one(temporalEntities, {
      fields: [temporalRelationships.fromEntityId],
      references: [temporalEntities.id],
      relationName: 'fromEntity',
    }),
    toEntity: one(temporalEntities, {
      fields: [temporalRelationships.toEntityId],
      references: [temporalEntities.id],
      relationName: 'toEntity',
    }),
  }),
);
