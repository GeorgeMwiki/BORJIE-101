/**
 * Cooperative Settlements — Wave COOPERATIVE-SETTLEMENT.
 *
 * Companion to:
 *   - packages/database/src/migrations/0105_cooperative_settlements.sql
 *   - services/api-gateway/src/routes/cooperatives/settlements.hono.ts
 *
 * Cooperatives (FEMATA, REMATA, AMRI, etc.) aggregate output from
 * member miners and settle the pool periodically. The two tables:
 *
 *   - cooperative_settlement_periods    one per (cooperative, period)
 *   - cooperative_member_distributions  per-member share within a period
 *
 * Money path: distributions hit `LedgerService.post()` per member; the
 * `payment_ref` column carries the ledger handle for forensic replay.
 *
 * Tenant-scoped via the canonical `app.current_tenant_id` GUC RLS
 * policy. FORCE RLS is enabled per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  date,
  jsonb,
  uuid,
  numeric,
  index,
} from 'drizzle-orm/pg-core';

export const COOP_PERIOD_STATUSES = [
  'draft',
  'calculated',
  'approved',
  'distributed',
  'contested',
] as const;
export type CooperativePeriodStatus = (typeof COOP_PERIOD_STATUSES)[number];

export const cooperativeSettlementPeriods = pgTable(
  'cooperative_settlement_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    cooperativePartyId: uuid('cooperative_party_id').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    totalVolumeKg: numeric('total_volume_kg', { precision: 14, scale: 3 })
      .notNull()
      .default('0'),
    totalRevenueTzs: numeric('total_revenue_tzs', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    leviesTzs: numeric('levies_tzs', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    netDistributableTzs: numeric('net_distributable_tzs', {
      precision: 18,
      scale: 2,
    })
      .notNull()
      .default('0'),
    status: text('status').notNull().default('draft'),
    approvedById: uuid('approved_by_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    distributedAt: timestamp('distributed_at', { withTimezone: true }),
    fourEyeRequestId: uuid('four_eye_request_id'),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    auditHashId: text('audit_hash_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantStatusIdx: index('cooperative_settlement_periods_tenant_status').on(
      table.tenantId,
      table.status,
      table.periodEnd,
    ),
  }),
);

export type CooperativeSettlementPeriod =
  typeof cooperativeSettlementPeriods.$inferSelect;
export type NewCooperativeSettlementPeriod =
  typeof cooperativeSettlementPeriods.$inferInsert;

export const cooperativeMemberDistributions = pgTable(
  'cooperative_member_distributions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    periodId: uuid('period_id')
      .notNull()
      .references(() => cooperativeSettlementPeriods.id, {
        onDelete: 'cascade',
      }),
    memberPartyId: uuid('member_party_id').notNull(),
    sharePct: numeric('share_pct', { precision: 7, scale: 4 }).notNull(),
    amountTzs: numeric('amount_tzs', { precision: 18, scale: 2 }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paymentRef: text('payment_ref'),
    auditHashId: text('audit_hash_id'),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantPeriodIdx: index('cooperative_member_distributions_tenant_period').on(
      table.tenantId,
      table.periodId,
    ),
  }),
);

export type CooperativeMemberDistribution =
  typeof cooperativeMemberDistributions.$inferSelect;
export type NewCooperativeMemberDistribution =
  typeof cooperativeMemberDistributions.$inferInsert;
