/**
 * Regulator jurisdictions — tenant-agnostic catalogue of regulatory
 * authorities per country (issue #207 world-scale tenants).
 *
 * Companion to:
 *   - packages/database/src/migrations/0143_regulator_jurisdictions.sql
 *   - services/api-gateway/src/services/tenant-config/*
 *   - packages/database/src/seeds/regulator-jurisdictions.seed.ts
 *
 * Tenant-AGNOSTIC by design. Regulators publish the same authority
 * catalogue to every operator — same model as `regulatory_zones` and
 * `intelligence_corpus_chunks`.
 *
 * Bilingual sw/en + local language per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  date,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const REGULATOR_SETS = [
  'TZ-set',
  'KE-set',
  'UG-set',
  'NG-set',
  'ZA-set',
  'AU-set',
  'CL-set',
  'ID-set',
  'generic',
] as const;
export type RegulatorSet = (typeof REGULATOR_SETS)[number];

export const REGULATOR_MANDATES = [
  'anti-corruption',
  'environment',
  'transparency-eiti',
  'mining-licensing',
  'safety',
  'royalty',
  'tax',
  'generic',
] as const;
export type RegulatorMandate = (typeof REGULATOR_MANDATES)[number];

export const regulatorJurisdictions = pgTable(
  'regulator_jurisdictions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryCode: text('country_code').notNull(),
    nameEn: text('name_en').notNull(),
    nameLocal: text('name_local'),
    slug: text('slug').notNull(),
    regulatorSet: text('regulator_set').notNull(),
    mandate: text('mandate').notNull(),
    contactUrl: text('contact_url'),
    dsrEndpoint: text('dsr_endpoint'),
    licenceRenewalEndpoint: text('licence_renewal_endpoint'),
    attributes: jsonb('attributes').notNull().default({}),
    activeFrom: date('active_from'),
    activeUntil: date('active_until'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    setSlugUnq: uniqueIndex('regulator_jurisdictions_set_slug_unq').on(
      t.regulatorSet,
      t.slug,
    ),
    countryIdx: index('regulator_jurisdictions_country_idx').on(t.countryCode),
    setIdx: index('regulator_jurisdictions_set_idx').on(t.regulatorSet),
  }),
);

export type RegulatorJurisdiction = typeof regulatorJurisdictions.$inferSelect;
export type NewRegulatorJurisdiction =
  typeof regulatorJurisdictions.$inferInsert;
