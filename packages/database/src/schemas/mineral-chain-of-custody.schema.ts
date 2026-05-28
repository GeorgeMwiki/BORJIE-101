/**
 * mineral_chain_of_custody — append-only hash-chained ledger of
 * pit-to-buyer ore movement steps. Every step references the previous
 * step's hash so any tamper attempt breaks the chain.
 *
 * Companion to:
 *   - packages/database/src/migrations/0093_full_mining_operations_scope.sql
 *   - services/api-gateway/src/routes/ops/chain-of-custody.hono.ts
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  numeric,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const mineralChainOfCustody = pgTable(
  'mineral_chain_of_custody',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    parcelId: text('parcel_id').notNull(),
    stepIndex: integer('step_index').notNull(),
    fromPartyId: uuid('from_party_id'),
    toPartyId: uuid('to_party_id').notNull(),
    /** extract | transport | process | smelt | refine | assay | export
     *  | sell | store | transfer | split | merge. */
    action: text('action').notNull(),
    happenedAt: timestamp('happened_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    weightGrams: numeric('weight_grams', { precision: 20, scale: 3 }),
    gradePct: numeric('grade_pct', { precision: 7, scale: 4 }),
    containerSealNo: text('container_seal_no'),
    location: text('location'),
    auditHashId: uuid('audit_hash_id').notNull(),
    prevAuditHash: text('prev_audit_hash').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    parcelStepUnique: uniqueIndex('cco_uniq_parcel_step').on(
      t.tenantId,
      t.parcelId,
      t.stepIndex,
    ),
    tenantParcelIdx: index('idx_cco_tenant_parcel').on(
      t.tenantId,
      t.parcelId,
      t.stepIndex,
    ),
  }),
);

export type MineralChainOfCustodyStep =
  typeof mineralChainOfCustody.$inferSelect;
export type NewMineralChainOfCustodyStep =
  typeof mineralChainOfCustody.$inferInsert;

export const CHAIN_OF_CUSTODY_ACTIONS = [
  'extract',
  'transport',
  'process',
  'smelt',
  'refine',
  'assay',
  'export',
  'sell',
  'store',
  'transfer',
  'split',
  'merge',
] as const;
export type ChainOfCustodyAction =
  (typeof CHAIN_OF_CUSTODY_ACTIONS)[number];
