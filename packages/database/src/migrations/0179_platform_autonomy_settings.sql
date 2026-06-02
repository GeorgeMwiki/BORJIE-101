-- =============================================================================
-- Migration 0179 — platform_autonomy_settings: cross-tenant Control-Tower knobs
-- that have no existing backing store (rate caps + throttles).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The admin Control Tower (apps/admin-web .../control-tower) exposes five
-- cross-tenant levers. Three already have a real backing store:
--   * global kill-switch     -> platform_killswitch_state   (0138)
--   * junior-agent autonomy  -> platform_feature_flags      (0137, boolean flag)
--   * predictions append-mode-> platform_feature_flags      (0137, boolean flag)
-- The remaining two are NUMERIC platform ceilings with no home:
--   * outbound webhook rate cap     (req/min/tenant)
--   * embeddings token throttle     (tokens/min/tenant)
-- A boolean feature flag cannot carry a number, and the killswitch table is a
-- level enum — so we add a single small key/value settings table that mirrors
-- the platform_* sibling shape (one row per setting key, last-set audit columns).
--
-- PLATFORM-GLOBAL — NOT TENANT-SCOPED (deliberate, mirrors its siblings)
-- ---------------------------------------------------------------------
-- Like platform_killswitch_state and platform_feature_flags(scope='global'),
-- this table holds CROSS-TENANT operator configuration. It has NO tenant_id
-- column and is written ONLY by SUPER_ADMIN/ADMIN through the four-eye-gated
-- Control-Tower route. Per CLAUDE.md the RLS-FORCE rule binds *tenant-scoped*
-- tables; a platform-global config table is intentionally outside that rule
-- (its siblings carry no RLS either). We still REVOKE the Supabase `anon` role
-- so an unauthenticated client can never read or write it.
--
-- NO MONEY COLUMNS. These are operational rate ceilings, not ledger values.
--
-- IDEMPOTENT / FORWARD-ONLY: IF NOT EXISTS + seed via ON CONFLICT DO NOTHING +
-- pg_roles anon guard. Safe to re-run. Append-only per CLAUDE.md
-- "Migrations are immutable".
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — platform_autonomy_settings
--
-- `setting_key` is a stable snake_case identifier (e.g. webhook_rate_cap_per_min).
-- `enabled` toggles whether the ceiling is enforced at all (the Control-Tower
-- On/Off chip). `int_value` carries the numeric ceiling when applicable (NULL for
-- pure on/off knobs). prev_* snapshots support the rollback contract used by the
-- killswitch + feature-flag adapters so Control-Tower changes are reversible.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_autonomy_settings (
  id              TEXT PRIMARY KEY,
  setting_key     TEXT NOT NULL UNIQUE,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  int_value       INTEGER,
  note            TEXT,
  prev_enabled    BOOLEAN,
  prev_int_value  INTEGER,
  set_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  set_by          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS platform_autonomy_settings_set_at_idx
  ON platform_autonomy_settings(set_at);

-- -----------------------------------------------------------------------------
-- §2 — Seed the two numeric ceilings the Control Tower drives so they show up
-- in operator listings immediately (defaults match the UI copy: 600 req/min
-- webhook cap; embeddings throttle ON). `set_by='system:migration_0179'` marks
-- the seed origin; the first operator change overwrites it + snapshots prev_*.
-- ON CONFLICT DO NOTHING keeps the seed idempotent across re-runs.
-- -----------------------------------------------------------------------------

INSERT INTO platform_autonomy_settings (id, setting_key, enabled, int_value, set_by)
VALUES
  ('seed_webhook_rate_cap', 'webhook_rate_cap_per_min', TRUE, 600, 'system:migration_0179'),
  ('seed_embed_throttle',   'embed_token_throttle_per_min', TRUE, 100000, 'system:migration_0179')
ON CONFLICT (setting_key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- §3 — anon REVOKE. Platform-global config: no tenant RLS (see header), but an
-- unauthenticated Supabase client must never touch it. Guarded so the migration
-- still applies on a vanilla Postgres (CI empty-PG / non-Supabase env).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.platform_autonomy_settings FROM anon;';
  END IF;
END $$;

COMMENT ON TABLE platform_autonomy_settings IS
  'Cross-tenant Control-Tower numeric/boolean knobs with no existing backing '
  'store (webhook rate cap, embeddings token throttle). Platform-GLOBAL (no '
  'tenant_id, no RLS — mirrors platform_killswitch_state / platform_feature_flags). '
  'Written ONLY by SUPER_ADMIN/ADMIN via the four-eye-gated Control-Tower route. '
  'NO money columns. anon REVOKEd. Added in 0179.';

COMMIT;
