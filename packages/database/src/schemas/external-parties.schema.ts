/**
 * external_parties — every off-mine counterparty in the Borjie
 * operating universe. Eighteen kinds covering the upstream
 * (licensing/survey), downstream (transport/processors/smelters/
 * refiners/assayers/exporters/banks/regulators/off_takers), and
 * adjacent (logistics/CSR/env-monitor/gov-liaison/legal/insurance/
 * security) layers.
 *
 * Companion to:
 *   - packages/database/src/migrations/0093_full_mining_operations_scope.sql
 *   - services/api-gateway/src/routes/ops/external-parties.hono.ts
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  uuid,
  numeric,
  index,
} from 'drizzle-orm/pg-core';

export const externalParties = pgTable(
  'external_parties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** licensing_office | survey_firm | transport_co | processor |
     *  smelter | refiner | assayer | exporter | bank | regulator |
     *  off_taker | logistics_co | csr_community | env_monitor |
     *  gov_liaison | legal_counsel | insurance | security_firm. */
    partyType: text('party_type').notNull(),
    name: text('name').notNull(),
    tin: text('tin'),
    brelaNo: text('brela_no'),
    country: text('country').notNull().default('TZ'),
    region: text('region'),
    primaryContact: jsonb('primary_contact').notNull().default({}),
    paymentTerms: jsonb('payment_terms').notNull().default({}),
    scorecardScore: numeric('scorecard_score', { precision: 4, scale: 2 })
      .notNull()
      .default('0'),
    status: text('status').notNull().default('active'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantTypeIdx: index('idx_external_parties_tenant_type').on(
      t.tenantId,
      t.partyType,
      t.status,
    ),
    tenantNameIdx: index('idx_external_parties_tenant_name').on(
      t.tenantId,
      t.name,
    ),
  }),
);

export type ExternalParty = typeof externalParties.$inferSelect;
export type NewExternalParty = typeof externalParties.$inferInsert;

export const EXTERNAL_PARTY_TYPES = [
  'licensing_office',
  'survey_firm',
  'transport_co',
  'processor',
  'smelter',
  'refiner',
  'assayer',
  'exporter',
  'bank',
  'regulator',
  'off_taker',
  'logistics_co',
  'csr_community',
  'env_monitor',
  'gov_liaison',
  'legal_counsel',
  'insurance',
  'security_firm',
] as const;
export type ExternalPartyType = (typeof EXTERNAL_PARTY_TYPES)[number];
