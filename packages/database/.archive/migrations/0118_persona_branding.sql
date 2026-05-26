-- ─────────────────────────────────────────────────────────────────────
-- Migration 0118 — Persona branding.
--
-- Per-tenant overrides for the central-intelligence kernel persona.
-- An agency operating its own portal can re-skin the AI's display
-- name and prepend an openingPreamble to the surface-default opening
-- statement, plus bind an optional voice profile id used by the voice-
-- bridge when speaking on a voice surface.
--
-- Composite primary key: (tenant_id, surface). An empty-string
-- `surface` value is the sentinel for "applies to ALL surfaces for
-- this tenant"; surface-specific rows ('owner-portal', 'tenant-app',
-- etc.) override the surface-agnostic fallback. The companion service
-- (`packages/database/src/services/persona-branding.service.ts`)
-- implements the surface → '' fallback at read time.
--
-- Voice / tone / taboos / first-person-noun all flow through unchanged
-- from the kernel's surface-default persona — this table only re-skins
-- displayName + opening + voice profile id.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS persona_branding (
  tenant_id          TEXT NOT NULL,
  surface            TEXT NOT NULL DEFAULT '',
  display_name       TEXT,
  opening_preamble   TEXT,
  voice_profile_id   TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, surface)
);

COMMENT ON TABLE persona_branding IS
  'Per-tenant overrides for kernel persona displayName / openingPreamble / voice profile. Composite PK (tenant_id, surface); empty surface = applies to all surfaces.';
