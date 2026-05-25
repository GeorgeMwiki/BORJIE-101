/**
 * Mining licences + licence events — Borjie mining domain.
 *
 * Per DATA_MODEL.md §3.1. A `licence` is a TZ mining title held by a
 * company. Types: PL (Prospecting), PML (Primary Mining Licence), ML
 * (Mining Licence), SML (Special Mining Licence), plus DEALER / BROKER /
 * PROCESSING / SMELTING / REFINING.
 *
 * Licence polygons stored as PostGIS `geography(POLYGON, 4326)` — raw SQL
 * column added via the migration; Drizzle exposes it as `text` (GeoJSON)
 * at the ORM boundary. PostGIS index lives in the migration.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  smallint,
  jsonb,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';
import { companies } from './companies.schema.js';

export const licences = pgTable(
  'licences',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** PL|PML|ML|SML|DEALER|BROKER|PROCESSING|SMELTING|REFINING. */
    kind: text('kind').notNull(),
    /** Government-issued licence number — unique within its kind. */
    number: text('number').notNull(),
    /** ISO mineral code or named gem (Au|Cu|Au+Cu|tanzanite|...). */
    mineral: text('mineral').notNull(),
    holderUserId: text('holder_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    grantDate: date('grant_date'),
    expiryDate: date('expiry_date'),
    /** Area in hectares. */
    areaHa: numeric('area_ha', { precision: 12, scale: 4 }),
    /** PostGIS geography(POLYGON, 4326); read/written as GeoJSON at the ORM boundary. */
    polygon: text('polygon'),
    /** active|pending|expired|surrendered|cancelled|disputed. */
    status: text('status').notNull().default('active'),
    /** {annual_fee_tzs, royalty_rate_pct, inspection_pct, ...}. */
    fees: jsonb('fees').notNull().default({}),
    /** Obligations checklist (EPP, EIA, community benefit, etc.). */
    obligations: jsonb('obligations').notNull().default({}),
    /** 0-100 dormancy / inactivity score; high = at risk of cancellation. */
    dormancyScore: smallint('dormancy_score').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('licences_tenant_idx').on(t.tenantId),
    companyIdx: index('licences_company_idx').on(t.companyId),
    numberKindIdx: uniqueIndex('licences_number_kind_idx').on(
      t.tenantId,
      t.kind,
      t.number,
    ),
    expiryIdx: index('licences_tenant_expiry_idx').on(t.tenantId, t.expiryDate),
    statusIdx: index('licences_status_idx').on(t.tenantId, t.status),
  }),
);

// ============================================================================
// licence_events — renewals, payments, breaches, notices
// ============================================================================

export const licenceEvents = pgTable(
  'licence_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    licenceId: text('licence_id')
      .notNull()
      .references(() => licences.id, { onDelete: 'cascade' }),
    /**
     * renewal_due|payment_due|notice_of_breach|relinquishment|
     * inspection_scheduled|inspection_finding|condition_change|...
     */
    kind: text('kind').notNull(),
    /** Free-form summary for the operator. */
    summary: text('summary'),
    dueDate: date('due_date'),
    /** open|in_progress|completed|escalated|cancelled. */
    status: text('status').notNull().default('open'),
    /** {amount_tzs, reference_no, evidence_url, decision_reason, ...}. */
    payload: jsonb('payload').notNull().default({}),
    /** Document IDs in `documents` that prove this event happened. */
    evidenceIds: text('evidence_ids').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('licence_events_tenant_idx').on(t.tenantId),
    licenceIdx: index('licence_events_licence_idx').on(t.licenceId),
    statusDueIdx: index('licence_events_status_due_idx').on(
      t.tenantId,
      t.status,
      t.dueDate,
    ),
  }),
);

export type Licence = typeof licences.$inferSelect;
export type NewLicence = typeof licences.$inferInsert;
export type LicenceEvent = typeof licenceEvents.$inferSelect;
export type NewLicenceEvent = typeof licenceEvents.$inferInsert;
