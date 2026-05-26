-- ─────────────────────────────────────────────────────────────────────
-- Migration 0137 — platform_feature_flags (Central Command HQ tools).
--
-- Backs the `platform.read_feature_flag` + `platform.set_feature_flag`
-- HQ-tier tools. The existing `feature_flags` + `tenant_feature_flag_overrides`
-- tables only support BOOLEAN values; HQ needs `boolean | string` AND
-- a full audit history (who last set, when). New table rather than
-- mutating the legacy enterprise-polish ones.
--
-- One row per `(scope, flag_name)`:
--   - `scope = 'global'`        — platform-wide default
--   - `scope = 'tenant:<id>'`   — per-tenant override
--
-- Idempotent: CREATE ... IF NOT EXISTS guards everywhere.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_feature_flags (
  id              TEXT PRIMARY KEY,
  scope           TEXT NOT NULL,
  flag_name       TEXT NOT NULL,
  flag_value      JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT NOT NULL,
  last_set_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_set_by     TEXT NOT NULL,
  CONSTRAINT uq_platform_feature_flags_scope_flag UNIQUE (scope, flag_name)
);

CREATE INDEX IF NOT EXISTS idx_platform_feature_flags_flag_name
  ON platform_feature_flags (flag_name);

CREATE INDEX IF NOT EXISTS idx_platform_feature_flags_scope
  ON platform_feature_flags (scope);

COMMENT ON TABLE platform_feature_flags IS
  'HQ-tier feature flags. One row per (scope, flag_name). scope = "global" | "tenant:<id>". flag_value is JSONB so values can be boolean or free-form string variants.';
COMMENT ON COLUMN platform_feature_flags.scope IS
  '"global" for the platform-wide default; "tenant:<tenantId>" for per-tenant override.';
COMMENT ON COLUMN platform_feature_flags.flag_value IS
  'JSONB-encoded boolean or string. The HQ-tool FeatureFlagValueSchema enforces the union at the API boundary.';
