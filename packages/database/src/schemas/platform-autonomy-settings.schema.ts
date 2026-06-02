/**
 * platform_autonomy_settings — cross-tenant Control-Tower knobs that have
 * no other backing store (numeric rate caps + boolean throttles).
 *
 * WS-5 (admin Control Tower). Companion to:
 *   - packages/database/src/migrations/0179_platform_autonomy_settings.sql
 *   - packages/database/src/services/platform/autonomy-settings.service.ts
 *   - services/api-gateway/src/routes/admin/control-tower.hono.ts
 *
 * The Control Tower exposes five cross-tenant levers. Three are already
 * backed (kill-switch -> platform_killswitch_state; junior-autonomy +
 * predictions-mode -> platform_feature_flags boolean flags). The two that
 * need a NUMBER live here:
 *   - webhook_rate_cap_per_min      outbound webhook ceiling (req/min/tenant)
 *   - embed_token_throttle_per_min  embeddings spend ceiling (tokens/min/tenant)
 *
 * PLATFORM-GLOBAL — there is intentionally NO tenant_id column and NO RLS
 * (mirrors platform_killswitch_state / platform_feature_flags scope='global').
 * Written only by SUPER_ADMIN/ADMIN through the four-eye-gated route. The
 * `anon` Supabase role is REVOKEd in the migration.
 */

import {
  pgTable,
  text,
  boolean,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const platformAutonomySettings = pgTable(
  'platform_autonomy_settings',
  {
    id: text('id').primaryKey(),
    /** Stable snake_case key, e.g. `webhook_rate_cap_per_min`. Unique. */
    settingKey: text('setting_key').notNull().unique(),
    /** The Control-Tower On/Off chip — is the ceiling enforced at all. */
    enabled: boolean('enabled').notNull().default(true),
    /** Numeric ceiling when applicable; NULL for pure on/off knobs. */
    intValue: integer('int_value'),
    /** Optional free-form operator note. */
    note: text('note'),
    /** Previous `enabled` snapshot — rollback contract. */
    prevEnabled: boolean('prev_enabled'),
    /** Previous `int_value` snapshot — rollback contract. */
    prevIntValue: integer('prev_int_value'),
    setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
    setBy: text('set_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    setAtIdx: index('platform_autonomy_settings_set_at_idx').on(t.setAt),
  }),
);

export type PlatformAutonomySettingRow =
  typeof platformAutonomySettings.$inferSelect;
export type NewPlatformAutonomySettingRow =
  typeof platformAutonomySettings.$inferInsert;

/**
 * Canonical setting keys the Control Tower drives. Re-exported so the route
 * + tests iterate one source of truth instead of re-declaring the strings.
 */
export const PLATFORM_AUTONOMY_SETTING_KEYS = {
  WEBHOOK_RATE_CAP: 'webhook_rate_cap_per_min',
  EMBED_THROTTLE: 'embed_token_throttle_per_min',
} as const;

export type PlatformAutonomySettingKey =
  (typeof PLATFORM_AUTONOMY_SETTING_KEYS)[keyof typeof PLATFORM_AUTONOMY_SETTING_KEYS];
