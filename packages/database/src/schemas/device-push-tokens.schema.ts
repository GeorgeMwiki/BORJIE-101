/**
 * device_push_tokens (migration 0139) — push-notification token registry.
 *
 * Drizzle representation of the EXISTING `device_push_tokens` table. The
 * raw-SQL registration route (`routes/me/device-tokens.hono.ts`) and the
 * notification dispatcher already read/write this table via `sql`-tagged
 * queries; this schema gives the rest of the codebase a typed handle on
 * the same rows (e.g. the push fan-out resolving a user's active
 * `expo_push_token`s) without a duplicate table.
 *
 * One row per (user, app, token-triple). The composite uniqueness index
 * collapses re-registrations from the same device into one row so
 * reinstalls don't pile up dead tokens. `revoked_at` soft-deletes tokens
 * the provider has told us are invalid (Expo `DeviceNotRegistered`, FCM
 * `UNREGISTERED`, APNS `Unregistered`) so they're skipped on dispatch
 * without losing the audit trail.
 *
 * Tenant scope (CLAUDE.md hard rule): `tenant_id` is a uuid (this table
 * predates the text-tenant convention; the column type MUST match the
 * shipped migration). The table FORCE-enables RLS on the canonical
 * `app.current_tenant_id` GUC — see migration 0139.
 *
 * Companion files:
 *   - packages/database/src/migrations/0139_device_push_tokens.sql
 *   - services/api-gateway/src/routes/me/device-tokens.hono.ts
 *   - services/api-gateway/src/services/notification-dispatch/push-provider.ts
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

/** Device platform — matches `device_push_tokens_platform_chk`. */
export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** Registering surface — matches `device_push_tokens_app_chk`. */
export const DEVICE_APPS = [
  'owner-web',
  'admin-web',
  'workforce-mobile',
  'buyer-mobile',
] as const;
export type DeviceApp = (typeof DEVICE_APPS)[number];

export const devicePushTokens = pgTable(
  'device_push_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** uuid to match migration 0139 (predates the text-tenant convention). */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Supabase user id (`auth.users.id`), quoted to text per Borjie convention. */
    userId: text('user_id').notNull(),
    /** ios | android | web */
    platform: text('platform').notNull(),
    /** owner-web | admin-web | workforce-mobile | buyer-mobile */
    app: text('app').notNull(),
    /** Expo push token (`ExponentPushToken[...]`) — the push fan-out rail. */
    expoPushToken: text('expo_push_token'),
    /** FCM token — Android and bare-RN iOS via APNS-over-FCM. */
    fcmToken: text('fcm_token'),
    /** Native APNS token — used only when bypassing FCM. */
    apnsToken: text('apns_token'),
    installedAt: timestamp('installed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set when the provider tells us the token is unregistered. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantUserActiveIdx: index('device_push_tokens_tenant_user_active_idx').on(
      t.tenantId,
      t.userId,
    ),
    appActiveIdx: index('device_push_tokens_app_active_idx').on(t.app),
  }),
);

export type DevicePushTokenRow = typeof devicePushTokens.$inferSelect;
export type DevicePushTokenInsert = typeof devicePushTokens.$inferInsert;
