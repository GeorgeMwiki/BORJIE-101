/**
 * AI cost ledger + per-tenant budgets — Wave 9 enterprise polish.
 *
 * - `ai_cost_entries` — append-only log of every LLM call (one row per call).
 * - `tenant_ai_budgets` — per-tenant monthly USD cap (stored as microdollars).
 *
 * Costs are stored as BIGINT microdollars so we never touch floats.
 */

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const aiCostEntries = pgTable(
  'ai_cost_entries',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsdMicro: bigint('cost_usd_micro', { mode: 'number' })
      .notNull()
      .default(0),
    operation: text('operation'),
    correlationId: text('correlation_id'),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantTimeIdx: index('idx_ai_cost_tenant_time').on(
      table.tenantId,
      table.occurredAt,
    ),
    tenantModelIdx: index('idx_ai_cost_tenant_model').on(
      table.tenantId,
      table.model,
    ),
  }),
);

export const tenantAiBudgets = pgTable('tenant_ai_budgets', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  monthlyCapUsdMicro: bigint('monthly_cap_usd_micro', { mode: 'number' })
    .notNull()
    .default(0),
  hardStop: boolean('hard_stop').notNull().default(true),
  updatedBy: text('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
