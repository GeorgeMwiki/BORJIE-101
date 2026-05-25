/**
 * Persona branding (migration 0118).
 *
 * Per-tenant overrides for the kernel's central-intelligence persona.
 * Each tenant (typically an agency operating their own portal under a
 * managed brand) can re-skin the AI persona's displayName and prepend
 * an openingPreamble to the surface-default opening statement, plus
 * optionally bind a voice profile id used by the voice-bridge when
 * speaking on a voice surface.
 *
 * Composite primary key: (tenant_id, surface). The `surface` column
 * uses an empty-string sentinel ('') to mean "applies to ALL surfaces"
 * for that tenant; surface-specific rows ('owner-portal', 'tenant-app',
 * etc.) override the empty-surface fallback. The companion service
 * (`packages/database/src/services/persona-branding.service.ts`)
 * implements the `surface → ''` fallback at read time.
 *
 * Mirrors LITFIN's bank-snapshot configuration pattern: a small,
 * tenant-scoped knob set re-skins the AI without replacing its
 * underlying voice rules — toneGuidance, taboos, violationSignals,
 * firstPersonNoun all flow through unchanged from the kernel default.
 */

import {
  pgTable,
  text,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core';

export const personaBranding = pgTable(
  'persona_branding',
  {
    tenantId: text('tenant_id').notNull(),
    /** Empty string = applies to ALL surfaces for the tenant. */
    surface: text('surface').notNull().default(''),
    displayName: text('display_name'),
    openingPreamble: text('opening_preamble'),
    voiceProfileId: text('voice_profile_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.surface] }),
  }),
);
