/**
 * Estate Capital Movements — Wave ESTATE-OS.
 *
 * Companion to:
 *   - packages/database/src/migrations/0094_mining_estate_holdings.sql
 *   - services/api-gateway/src/routes/estate/capital-movements.hono.ts
 *
 * The intercompany money log: dividends, capital injections,
 * intercompany loans, asset transfers, JV distributions, royalty
 * settlements, inheritance transfers, tax payments. This is the
 * ESTATE-LEVEL VIEW that links ledger entries to estate-entity
 * context. Money path STILL goes via `LedgerService.post()`.
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS policy.
 * FORCE RLS per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  numeric,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const ESTATE_CAPITAL_MOVEMENT_KINDS = [
  'intercompany_loan',
  'dividend',
  'capital_injection',
  'asset_transfer',
  'royalty_settlement',
  'tax_payment',
  'inheritance_transfer',
  'jv_distribution',
] as const;
export type EstateCapitalMovementKind =
  (typeof ESTATE_CAPITAL_MOVEMENT_KINDS)[number];

export const estateCapitalMovements = pgTable(
  'estate_capital_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    fromEntityId: uuid('from_entity_id'),
    toEntityId: uuid('to_entity_id'),
    /** What kind of intercompany flow this is. */
    kind: text('kind').notNull(),
    /** Monetary amount in the currency given below. */
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
    /** ISO-4217 currency code. */
    currency: text('currency').notNull().default('TZS'),
    /** When the flow happened. */
    happenedAt: timestamp('happened_at', { withTimezone: true }).notNull(),
    /** Short narrative the owner reads on the timeline. */
    narrative: text('narrative'),
    /** Optional pointer to a supporting document. */
    docLinkId: uuid('doc_link_id'),
    /** Hash linking this row to the AI audit chain. */
    auditHashId: text('audit_hash_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    whenIdx: index('idx_estate_capital_movements_when').on(
      t.tenantId,
      t.happenedAt,
    ),
    fromIdx: index('idx_estate_capital_movements_from').on(
      t.fromEntityId,
      t.happenedAt,
    ),
    toIdx: index('idx_estate_capital_movements_to').on(
      t.toEntityId,
      t.happenedAt,
    ),
    idemUniq: uniqueIndex('estate_capital_movements_idem_uniq').on(
      t.tenantId,
      t.amount,
      t.happenedAt,
      t.fromEntityId,
      t.toEntityId,
      t.kind,
    ),
  }),
);

export type EstateCapitalMovementRow =
  typeof estateCapitalMovements.$inferSelect;
export type EstateCapitalMovementInsert =
  typeof estateCapitalMovements.$inferInsert;
