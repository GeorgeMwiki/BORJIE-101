/**
 * Owner Contact Preferences — Wave OWNER-CONTACT-RESOLVER.
 *
 * Companion to:
 *   - packages/database/src/migrations/0098_owner_contact_prefs.sql
 *   - services/api-gateway/src/services/owner-identity/resolver.ts
 *   - services/api-gateway/src/workers/reminders-dispatch.worker.ts
 *
 * One row per owner-eligible user (tenant_id, user_id). Stores the
 * preferred dispatch channel for reminders + daily brief plus the
 * per-channel addresses so the reminders worker no longer falls back
 * to a global env-var email.
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS policy.
 * FORCE RLS is enabled on the table per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const OWNER_CONTACT_CHANNELS = [
  'email',
  'sms',
  'slack',
  'whatsapp',
] as const;
export type OwnerContactChannel = (typeof OWNER_CONTACT_CHANNELS)[number];

export const OWNER_CONTACT_LOCALES = ['sw', 'en'] as const;
export type OwnerContactLocale = (typeof OWNER_CONTACT_LOCALES)[number];

export const ownerContactPrefs = pgTable(
  'owner_contact_prefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    emailOverride: text('email_override'),
    phone: text('phone'),
    slackHandle: text('slack_handle'),
    preferredChannel: text('preferred_channel').notNull().default('email'),
    locale: text('locale').notNull().default('sw'),
    timezone: text('timezone')
      .notNull()
      .default('Africa/Dar_es_Salaam'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantUserUniq: uniqueIndex('owner_contact_prefs_tenant_user_uniq').on(
      table.tenantId,
      table.userId,
    ),
    tenantIdx: index('owner_contact_prefs_tenant_idx').on(table.tenantId),
  }),
);

export type OwnerContactPrefsRow = typeof ownerContactPrefs.$inferSelect;
export type NewOwnerContactPrefsRow = typeof ownerContactPrefs.$inferInsert;
