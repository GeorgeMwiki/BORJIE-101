-- =============================================================================
-- Migration 0122 — compliance_exports
--
-- Companion to:
--   - services/api-gateway/src/routes/compliance.router.ts
--   - services/reports/src/compliance/compliance-export-service.ts
--   - packages/database/src/schemas/compliance-exports.schema.ts
--
-- Manifest of regulator-facing exports per tenant + export type:
--
--   tz_tra       — Tanzania Revenue Authority quarterly remittance
--                  (royalties + duties + VAT)
--   ke_dpa       — Kenya Data Protection Act controller register
--   ke_kra       — Kenya Revenue Authority quarterly remittance
--   tz_land_act  — Tanzania Land Act stewardship report (site
--                  rehabilitation + community access)
--
-- One row per scheduled / generated / downloaded export. Status
-- transitions: scheduled → generating → ready → downloaded |
-- archived | failed.
--
-- Restored from archive/0021_compliance_exports.sql (the BossNyumba
-- pre-fork schema) because the Borjie compliance route surface still
-- depends on it: GET /api/v1/compliance, POST /api/v1/compliance/exports.
--
-- Tenant scope: tenant_id::text = current_setting('app.current_tenant_id', true)
-- RLS FORCE-enabled per CLAUDE.md hard rule. Idempotent. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS compliance_exports (
  id                 text         PRIMARY KEY,
  tenant_id          text         NOT NULL,
  /** tz_tra | ke_dpa | ke_kra | tz_land_act. */
  export_type        text         NOT NULL,
  /** csv | json | xml | pdf. */
  format             text         NOT NULL,
  /** scheduled | generating | ready | downloaded | failed | archived. */
  status             text         NOT NULL DEFAULT 'scheduled',
  period_start       timestamptz  NOT NULL,
  period_end         timestamptz  NOT NULL,
  scheduled_at       timestamptz  NOT NULL DEFAULT now(),
  generated_at       timestamptz,
  downloaded_at      timestamptz,
  storage_key        text,
  file_size_bytes    integer,
  file_checksum      text,
  regulator_context  jsonb        NOT NULL DEFAULT '{}'::jsonb,
  error_message      text,
  requested_by       text,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'compliance_exports_type_chk'
  ) THEN
    ALTER TABLE compliance_exports
      ADD CONSTRAINT compliance_exports_type_chk
      CHECK (export_type IN ('tz_tra', 'ke_dpa', 'ke_kra', 'tz_land_act'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'compliance_exports_format_chk'
  ) THEN
    ALTER TABLE compliance_exports
      ADD CONSTRAINT compliance_exports_format_chk
      CHECK (format IN ('csv', 'json', 'xml', 'pdf'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'compliance_exports_status_chk'
  ) THEN
    ALTER TABLE compliance_exports
      ADD CONSTRAINT compliance_exports_status_chk
      CHECK (status IN (
        'scheduled', 'generating', 'ready', 'downloaded', 'failed', 'archived'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS compliance_exports_tenant_idx
  ON compliance_exports (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS compliance_exports_type_idx
  ON compliance_exports (tenant_id, export_type, created_at DESC);

CREATE INDEX IF NOT EXISTS compliance_exports_status_idx
  ON compliance_exports (tenant_id, status);

CREATE INDEX IF NOT EXISTS compliance_exports_period_idx
  ON compliance_exports (tenant_id, period_start, period_end);

ALTER TABLE compliance_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_exports FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'compliance_exports'
       AND policyname = 'compliance_exports_tenant_isolation'
  ) THEN
    CREATE POLICY compliance_exports_tenant_isolation
      ON compliance_exports
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
