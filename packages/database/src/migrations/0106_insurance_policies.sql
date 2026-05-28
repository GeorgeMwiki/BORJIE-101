-- =============================================================================
-- Migration 0106 - Insurance broker integration (quotes + policies).
--
-- Wave INSURANCE-BROKER. Mining operations carry six classes of cover
-- (workforce / plant / environmental / third-party / transit /
-- political risk). The broker integration service abstracts Tanzanian
-- brokers (Britam / NIC / Heritage) behind a single port and persists
-- quote + policy records under tenant-isolated tables.
--
-- Tables:
--   * insurance_quotes
--   * insurance_policies
--
-- Tenant scope:
--   tenant_id::text = current_setting('app.current_tenant_id', true)
--
-- RLS FORCE-enabled per CLAUDE.md. Idempotent. Forward-only.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- insurance_quotes
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS insurance_quotes (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  broker_party_id      uuid        NOT NULL,
  provider_id          text        NOT NULL,
  coverage_type        text        NOT NULL,
  sum_insured_tzs      numeric(18, 2) NOT NULL,
  premium_tzs          numeric(18, 2) NOT NULL,
  deductible_tzs       numeric(18, 2) NOT NULL DEFAULT 0,
  exclusions           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  valid_until          timestamptz NOT NULL,
  status               text        NOT NULL DEFAULT 'open',
  risk_profile         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  provenance           jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_hash_id        text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'insurance_quotes_coverage_chk'
  ) THEN
    ALTER TABLE insurance_quotes
      ADD CONSTRAINT insurance_quotes_coverage_chk
      CHECK (coverage_type IN (
        'workforce', 'plant', 'environmental', 'third_party', 'transit', 'political_risk'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'insurance_quotes_status_chk'
  ) THEN
    ALTER TABLE insurance_quotes
      ADD CONSTRAINT insurance_quotes_status_chk
      CHECK (status IN ('open', 'bound', 'expired', 'declined'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS insurance_quotes_tenant_status
  ON insurance_quotes (tenant_id, status, created_at DESC);

ALTER TABLE insurance_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_quotes FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'insurance_quotes'
       AND policyname = 'insurance_quotes_tenant_isolation'
  ) THEN
    CREATE POLICY insurance_quotes_tenant_isolation
      ON insurance_quotes
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- insurance_policies
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS insurance_policies (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  broker_party_id      uuid        NOT NULL,
  provider_id          text        NOT NULL,
  quote_id             uuid        REFERENCES insurance_quotes(id) ON DELETE SET NULL,
  policy_no            text        NOT NULL,
  coverage_type        text        NOT NULL,
  sum_insured_tzs      numeric(18, 2) NOT NULL,
  premium_tzs          numeric(18, 2) NOT NULL,
  deductible_tzs       numeric(18, 2) NOT NULL DEFAULT 0,
  exclusions           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  effective_at         timestamptz NOT NULL,
  expires_at           timestamptz NOT NULL,
  status               text        NOT NULL DEFAULT 'active',
  evidence_doc_id      uuid,
  cancelled_at         timestamptz,
  cancelled_reason     text,
  provenance           jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_hash_id        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'insurance_policies_coverage_chk'
  ) THEN
    ALTER TABLE insurance_policies
      ADD CONSTRAINT insurance_policies_coverage_chk
      CHECK (coverage_type IN (
        'workforce', 'plant', 'environmental', 'third_party', 'transit', 'political_risk'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'insurance_policies_status_chk'
  ) THEN
    ALTER TABLE insurance_policies
      ADD CONSTRAINT insurance_policies_status_chk
      CHECK (status IN ('active', 'cancelled', 'expired', 'lapsed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'insurance_policies_dates_chk'
  ) THEN
    ALTER TABLE insurance_policies
      ADD CONSTRAINT insurance_policies_dates_chk
      CHECK (expires_at > effective_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'insurance_policies_tenant_policy_uq'
  ) THEN
    ALTER TABLE insurance_policies
      ADD CONSTRAINT insurance_policies_tenant_policy_uq
      UNIQUE (tenant_id, policy_no);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS insurance_policies_tenant_active
  ON insurance_policies (tenant_id, status, expires_at);

ALTER TABLE insurance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_policies FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'insurance_policies'
       AND policyname = 'insurance_policies_tenant_isolation'
  ) THEN
    CREATE POLICY insurance_policies_tenant_isolation
      ON insurance_policies
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
