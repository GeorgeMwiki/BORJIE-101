/**
 * owner_calendar_connections — the owner's linked Google Calendar / Microsoft
 * 365 account for the `calendar` reminder delivery channel.
 *
 * Companion to migration 0171. Once the owner connects a provider via OAuth
 * (offline access + calendar scope), the calendar-sync worker upserts a native
 * calendar EVENT per Mr. Mwikila reminder (channel='calendar') and per
 * autonomous-worker time-bound item (licence renewals 90/60/30-day, royalty
 * deadlines, shifts) — idempotently, on a stable external id, so retries never
 * create duplicate events.
 *
 * ENCRYPTED tokens (CLAUDE.md / SECURITY hard rule)
 * -------------------------------------------------
 * `encryptedRefreshToken` / `encryptedAccessToken` hold AES-256-GCM sealed
 * blobs produced by the api-gateway `CalendarTokenCipher`
 * (`services/api-gateway/src/services/notification-dispatch/calendar-providers/
 * token-cipher.ts`). The column NEVER holds a plaintext token — there is no
 * plaintext token column by design.
 *
 * Tenant-isolation: RLS FORCE-enabled in migration 0171 on
 * `current_setting('app.current_tenant_id', true)` (mirrors 0164). The route
 * handlers additionally predicate on `user_id` in every query (belt-and-braces).
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// owner_calendar_connections — one linked calendar account per owner+provider
// ============================================================================

export const ownerCalendarConnections = pgTable(
  'owner_calendar_connections',
  {
    id: text('id').primaryKey(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /** The owner who linked the calendar (per-user scoping). */
    userId: text('user_id').notNull(),
    /** 'google' | 'microsoft' (CHECK in 0171). */
    provider: text('provider').notNull(),
    /**
     * AES-256-GCM sealed OAuth refresh token ("v1.gcm.<nonce>.<tag>.<ct>").
     * NEVER plaintext. Used to mint a fresh access token when the current one
     * expires.
     */
    encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
    /**
     * AES-256-GCM sealed OAuth access token. NEVER plaintext. NULL until the
     * first refresh; re-sealed on every refresh.
     */
    encryptedAccessToken: text('encrypted_access_token'),
    /** Wall-clock at which the access token expires (drives JIT refresh). */
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    /** Target calendar id ('primary' by default for Google / MS default). */
    calendarId: text('calendar_id').notNull().default('primary'),
    /** Space-delimited granted OAuth scopes (audit / re-consent decisions). */
    scope: text('scope'),
    connectedAt: timestamp('connected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Soft-revoke on disconnect; frees the active-unique slot, keeps audit. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    // Status / refresh hot path: this user's ACTIVE connection for this tenant.
    tenantUserIdx: index('owner_calendar_connections_tenant_user_idx').on(
      t.tenantId,
      t.userId,
    ),
    // At most ONE active (non-revoked) connection per (tenant, user, provider).
    // Partial unique on revoked_at IS NULL (mirrors the 0171 partial index).
    // Literal column name in the predicate (matches report-templates.schema.ts)
    // so the index builder's type survives cross-package declaration emit.
    activeUniq: uniqueIndex('owner_calendar_connections_active_uniq')
      .on(t.tenantId, t.userId, t.provider)
      .where(sql`revoked_at IS NULL`),
  }),
);

export type OwnerCalendarConnection =
  typeof ownerCalendarConnections.$inferSelect;
export type NewOwnerCalendarConnection =
  typeof ownerCalendarConnections.$inferInsert;

/** Closed set of supported calendar providers (mirrors the 0171 CHECK). */
export const CALENDAR_PROVIDERS = ['google', 'microsoft'] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];
