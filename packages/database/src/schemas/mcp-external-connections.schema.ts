/**
 * MCP external-client persistence (Wave 18BB-MCP-EXT).
 *
 * Companion to `Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md`. Drizzle types
 * for the 2 tables created by migration 0033_mcp_external_connections.sql:
 *
 *   - mcpExternalConnections → per-tenant connection records to public
 *                              MCP servers (Slack, GitHub, Notion, …).
 *                              `encrypted_credentials` is AES-GCM
 *                              ciphertext sealed with a tenant-bound
 *                              DEK. Tenant-scoped, RLS.
 *   - mcpToolInvocations     → per-invocation audit log; cross-walks
 *                              into the ai_audit_chain hash chain via
 *                              `audit_chain_id`. Tenant-scoped, RLS.
 *
 * Both tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  smallint,
  jsonb,
  uuid,
  boolean,
  customType,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

/**
 * `bytea` column wrapper. Drizzle exposes Postgres `bytea` as a typed
 * `customType` so the AES-GCM ciphertext round-trips through
 * `Uint8Array` without string mangling.
 */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value) {
    return Buffer.from(value);
  },
  fromDriver(value) {
    return new Uint8Array(value);
  },
});

// ============================================================================
// mcp_external_connections — per-tenant connection records
// ============================================================================

export const mcpExternalConnections = pgTable(
  'mcp_external_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Catalog id — matches `McpCatalogEntry.id` in mcp-external-client. */
    serverId: text('server_id').notNull(),
    displayName: text('display_name').notNull(),
    /** stdio | sse | http. CHECK constraint lives in the migration. */
    transport: text('transport').notNull(),
    /** none | api_key | oauth_token | oauth_pkce. */
    authMode: text('auth_mode').notNull(),
    /** AES-GCM ciphertext, sealed with a tenant-bound DEK from KMS. */
    encryptedCredentials: bytea('encrypted_credentials'),
    /** Granted OAuth scopes, copied from the auth flow. */
    scopes: jsonb('scopes').notNull().default([]),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by'),
  },
  (t) => ({
    tenantIdx: index('idx_mcp_conn_tenant').on(t.tenantId),
    uniqTenantServer: uniqueIndex('mcp_external_connections_tenant_server_uq')
      .on(t.tenantId, t.serverId),
  }),
);

// ============================================================================
// mcp_tool_invocations — per-invocation audit log
// ============================================================================

export const mcpToolInvocations = pgTable(
  'mcp_tool_invocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => mcpExternalConnections.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    correlationId: text('correlation_id'),
    /** Cross-walk into ai_audit_chain — the canonical Wave-11 hash chain. */
    auditChainId: text('audit_chain_id'),
    /** SHA-256 of canonicalised input — never the body itself (PII). */
    inputHash: text('input_hash').notNull(),
    outputHash: text('output_hash').notNull(),
    /** ok | error. */
    outcome: text('outcome').notNull(),
    errorMessage: text('error_message'),
    /** Mutation-authority tier the call was admitted under (0|1|2). */
    tier: smallint('tier').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
    /** Generated column: (finished_at - started_at) in ms. */
    durationMs: integer('duration_ms'),
  },
  (t) => ({
    tenantStartedIdx: index('idx_mcp_inv_tenant_started').on(
      t.tenantId,
      t.startedAt,
    ),
    connectionIdx: index('idx_mcp_inv_connection').on(
      t.connectionId,
      t.startedAt,
    ),
    correlationIdx: index('idx_mcp_inv_correlation').on(t.correlationId),
  }),
);

export type McpExternalConnection = typeof mcpExternalConnections.$inferSelect;
export type NewMcpExternalConnection =
  typeof mcpExternalConnections.$inferInsert;
export type McpToolInvocation = typeof mcpToolInvocations.$inferSelect;
export type NewMcpToolInvocation = typeof mcpToolInvocations.$inferInsert;
