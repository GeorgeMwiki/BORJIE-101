/**
 * OAuth2 Device Authorization Grant (RFC 8628) — agent-token persistence.
 *
 * Companion to migration 0118_oauth_agent_tokens.sql. Drizzle types for
 * the two tables that back the device-flow handshake the api-gateway
 * exposes to external MCP / CLI / SDK consumers:
 *
 *   - oauthDeviceCodes   → short-lived pending grants. A device requests
 *                          one via POST /oauth/device/code; the owner
 *                          approves / denies via the owner-web consent UI.
 *   - oauthAgentTokens   → long-lived per-agent access tokens. Hashed at
 *                          rest (SHA-256). Tenant + user scoped. Carries
 *                          a scope array. Revocation is non-destructive
 *                          (revoked_at).
 *
 * Both tables use the canonical `app.current_tenant_id` GUC RLS policy
 * (see migration 0118). Agent tokens are tenant-scoped; device codes
 * tolerate `tenant_id IS NULL` during the pending phase (before the
 * owner has bound the row to a tenant).
 *
 * NEVER read `token_hash` back to a client. Hashes only exist server-side
 * to validate incoming Bearer tokens; the cleartext `access_token` is
 * returned once at /oauth/token issuance and never again.
 */

import { pgTable, text, timestamp, uuid, index, uniqueIndex } from 'drizzle-orm/pg-core';

// ============================================================================
// oauth_device_codes — pending device-flow grants
// ============================================================================

export const oauthDeviceCodes = pgTable(
  'oauth_device_codes',
  {
    /** Opaque UUID returned to the device by /oauth/device/code. */
    deviceCode: text('device_code').primaryKey(),
    /** 8-char human code displayed to the owner. Excludes ambiguous chars. */
    userCode: text('user_code').notNull(),
    /** Self-declared client identifier (e.g. "claude-code", "cursor"). */
    clientId: text('client_id').notNull(),
    /** Optional friendly label shown to the owner during consent. */
    clientLabel: text('client_label'),
    /** Scopes requested by the device — narrows the eventual access token. */
    scopes: text('scopes').array().notNull().default([]),
    /** Set during /oauth/device/approve. NULL while pending. */
    tenantId: text('tenant_id'),
    /** Set during /oauth/device/approve. NULL while pending. */
    userId: text('user_id'),
    /** pending | approved | denied | expired | consumed */
    status: text('status').notNull().default('pending'),
    /** Hard expiry — short-lived (10 min) per RFC 8628 §3.5. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Owner-approval timestamp. NULL until owner clicks Approve. */
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /** Set when /oauth/token issues an access token from this device code. */
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userCodeUniq: uniqueIndex('oauth_device_codes_user_code_uniq').on(table.userCode),
    pendingByUserCode: index('idx_oauth_device_codes_user_code_pending').on(table.userCode),
    expiryIdx: index('idx_oauth_device_codes_expiry').on(table.expiresAt),
  }),
);

export type OAuthDeviceCode = typeof oauthDeviceCodes.$inferSelect;
export type NewOAuthDeviceCode = typeof oauthDeviceCodes.$inferInsert;

// ============================================================================
// oauth_agent_tokens — per-agent access tokens
// ============================================================================

export const oauthAgentTokens = pgTable(
  'oauth_agent_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** SHA-256 hex of the cleartext access token. UNIQUE. */
    tokenHash: text('token_hash').notNull(),
    /** Self-declared client identifier (carried from device code). */
    clientId: text('client_id').notNull(),
    /** Optional friendly label shown on /settings/connected-agents. */
    clientLabel: text('client_label'),
    /** Owning tenant. RLS predicate enforces tenant isolation. */
    tenantId: text('tenant_id').notNull(),
    /** Owning user (the human who approved the consent). */
    userId: text('user_id').notNull(),
    /** Authorised scopes. Routes assert scope membership before action. */
    scopes: text('scopes').array().notNull().default([]),
    issuedAt: timestamp('issued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Updated on every successful auth — drives "last used" UX. */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /** Optional expiry. NULL = no expiry beyond revocation. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Non-destructive revocation — NULL = active. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    tokenHashUniq: uniqueIndex('oauth_agent_tokens_token_hash_uniq').on(table.tokenHash),
    tenantActiveIdx: index('idx_oauth_agent_tokens_tenant_active').on(table.tenantId),
    userActiveIdx: index('idx_oauth_agent_tokens_user_active').on(table.userId),
  }),
);

export type OAuthAgentToken = typeof oauthAgentTokens.$inferSelect;
export type NewOAuthAgentToken = typeof oauthAgentTokens.$inferInsert;
