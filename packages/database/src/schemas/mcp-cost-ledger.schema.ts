/**
 * mcp_cost_ledger (migration 0301) — persisted MCP tool-call cost ledger.
 *
 * Backs the `@borjie/mcp-server` `CostLedgerPort` with a durable, MCP-native
 * store so per-tenant / per-server spend survives a restart and is shareable
 * across replicas — replacing the in-memory `createInMemoryCostLedger()` that
 * resets on every deploy. Unlike the lossy forward into `ai_cost_entries`,
 * this table keeps the MCP axes (`serverName`, `toolName`, free-vs-paid) so
 * aggregate spend can be sliced per (tenant, server) and per (tenant, tool).
 *
 * Tenant scope (CLAUDE.md hard rule — mirrors migrations 0289 / 0295): every
 * `tenant_id` is TEXT and FK→tenants; the table FORCE-enables RLS on the
 * canonical `app.current_tenant_id` GUC. The persisted writer ALSO carries
 * `tenantId` on every row + filters every aggregate read by it for
 * defence-in-depth.
 *
 * Currency neutrality (CLAUDE.md hard rule): the only money column is
 * `usdCost` — a NUMERIC US-dollar figure (MCP providers bill in USD upstream).
 * No tenant currency literal appears anywhere.
 *
 * Append-only: writers only ever INSERT; aggregation is a read-time SUM.
 *
 * Companion to:
 *   - packages/database/src/migrations/0301_mcp_cost_persistence.sql
 *   - services/api-gateway/src/composition/mcp/persistent-mcp-cost-ledger.ts
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const mcpCostLedger = pgTable(
  'mcp_cost_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Logical MCP server the tool belongs to (e.g. 'borjie-mcp-server'). */
    serverName: text('server_name').notNull(),
    /** Dotted MCP tool id that was invoked. */
    toolName: text('tool_name').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /** USD cost of this call — provider-billed dollars (see header note). */
    usdCost: numeric('usd_cost', { precision: 18, scale: 8 })
      .notNull()
      .default('0'),
    /** True when the call fell under a free tier / zero-cost tool. */
    wasFree: boolean('was_free').notNull().default(false),
    /** Correlation id for the originating request (audit / tracing join). */
    requestId: text('request_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantServerOccurredIdx: index(
      'idx_mcp_cost_ledger_tenant_server_occurred',
    ).on(t.tenantId, t.serverName, t.occurredAt),
    tenantToolOccurredIdx: index(
      'idx_mcp_cost_ledger_tenant_tool_occurred',
    ).on(t.tenantId, t.toolName, t.occurredAt),
    tenantOccurredIdx: index('idx_mcp_cost_ledger_tenant_occurred').on(
      t.tenantId,
      t.occurredAt,
    ),
  }),
);

export type McpCostLedgerRow = typeof mcpCostLedger.$inferSelect;
export type McpCostLedgerInsert = typeof mcpCostLedger.$inferInsert;
