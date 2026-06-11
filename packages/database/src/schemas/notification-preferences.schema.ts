/**
 * Notification Preferences — Wave AUDIT-FIX (owner-settings-2).
 *
 * Companion to:
 *   - packages/database/src/migrations/0329_notification_preferences.sql
 *   - services/api-gateway/src/routes/notification-preferences.router.ts
 *   - services/api-gateway/src/index.ts (DB-backed PreferencesApi)
 *
 * One row per (tenant_id, user_id). Stores the per-channel + per-template
 * notification toggles and an optional quiet-hours window the
 * /me/notification-preferences surface reads and writes. Replaces the prior
 * in-memory echo stub that lost every preference on restart.
 *
 * Tenant-scoped: FORCE RLS on the canonical `app.current_tenant_id` GUC per
 * CLAUDE.md hard rule (migration 0329 installs the tenant-isolation +
 * service-role-bypass policies).
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    /** Per-channel on/off toggles, e.g. { email: true, sms: false }. */
    channels: jsonb('channels')
      .$type<Readonly<Record<string, boolean>>>()
      .notNull()
      .default({}),
    /** Per-template on/off toggles, e.g. { royalty_due: true }. */
    templates: jsonb('templates')
      .$type<Readonly<Record<string, boolean>>>()
      .notNull()
      .default({}),
    /** Quiet-hours window start, "HH:MM" 24h, or null when unset. */
    quietHoursStart: text('quiet_hours_start'),
    /** Quiet-hours window end, "HH:MM" 24h, or null when unset. */
    quietHoursEnd: text('quiet_hours_end'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantUserUniq: uniqueIndex('notification_preferences_tenant_user_uniq').on(
      table.tenantId,
      table.userId,
    ),
  }),
);

export type NotificationPreferencesRow =
  typeof notificationPreferences.$inferSelect;
export type NewNotificationPreferencesRow =
  typeof notificationPreferences.$inferInsert;
