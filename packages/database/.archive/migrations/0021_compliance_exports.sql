-- =============================================================================
-- 0021: Compliance exports (TZ_TRA, KE_DPA, KE_KRA, TZ_LAND_ACT)
-- =============================================================================
-- Manifest of regulator-facing exports with status + storage key.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE compliance_export_type AS ENUM (
    'tz_tra', 'ke_dpa', 'ke_kra', 'tz_land_act'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance_export_status AS ENUM (
    'scheduled', 'generating', 'ready', 'downloaded', 'failed', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance_export_format AS ENUM (
    'csv', 'json', 'xml', 'pdf'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance_exports (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  export_type        compliance_export_type NOT NULL,
  format             compliance_export_format NOT NULL,
  status             compliance_export_status NOT NULL DEFAULT 'scheduled',
  period_start       TIMESTAMPTZ NOT NULL,
  period_end         TIMESTAMPTZ NOT NULL,
  scheduled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_at       TIMESTAMPTZ,
  downloaded_at      TIMESTAMPTZ,
  storage_key        TEXT,
  file_size_bytes    INTEGER,
  file_checksum      TEXT,
  regulator_context  JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message      TEXT,
  requested_by       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS compliance_exports_tenant_idx
  ON compliance_exports(tenant_id);
CREATE INDEX IF NOT EXISTS compliance_exports_type_idx
  ON compliance_exports(export_type);
CREATE INDEX IF NOT EXISTS compliance_exports_status_idx
  ON compliance_exports(status);
CREATE INDEX IF NOT EXISTS compliance_exports_period_idx
  ON compliance_exports(period_start, period_end);
