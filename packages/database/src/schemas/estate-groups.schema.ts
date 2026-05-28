/**
 * Estate Groups — Wave ESTATE-OS.
 *
 * Companion to:
 *   - packages/database/src/migrations/0094_mining_estate_holdings.sql
 *   - services/api-gateway/src/routes/estate/groups.hono.ts
 *
 * The family-office shell. One row per principal owner / holding
 * structure. Every other estate-* table chains up to a row here.
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS policy.
 * FORCE RLS per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export const ESTATE_HOLDING_TYPES = [
  'family_office',
  'investment_co',
  'trust',
  'sole_proprietor',
  'jv',
  'cooperative_apex',
] as const;
export type EstateHoldingType = (typeof ESTATE_HOLDING_TYPES)[number];

export const estateGroups = pgTable(
  'estate_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Tenant scope. Bound by RLS via `app.tenant_id` GUC. */
    tenantId: text('tenant_id').notNull(),
    /** Owner-supplied name for the family-office / group. */
    name: text('name').notNull(),
    /** Legal shape of the holding structure. */
    holdingType: text('holding_type').notNull().default('sole_proprietor'),
    /** ISO-3166 alpha-2 country code. Defaults to Tanzania. */
    country: text('country').notNull().default('TZ'),
    /** Principal owner legal name. */
    principalOwnerName: text('principal_owner_name').notNull(),
    /** Tanzanian NIDA national-ID. */
    principalOwnerNida: text('principal_owner_nida'),
    /** TIN (Taxpayer Identification Number). */
    principalOwnerTin: text('principal_owner_tin'),
    /** Year the holding structure was founded. */
    foundingYear: integer('founding_year'),
    /** Optional pointer to a succession will document. */
    successionDocId: uuid('succession_doc_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('idx_estate_groups_tenant').on(t.tenantId, t.createdAt),
  }),
);

export type EstateGroupRow = typeof estateGroups.$inferSelect;
export type EstateGroupInsert = typeof estateGroups.$inferInsert;
