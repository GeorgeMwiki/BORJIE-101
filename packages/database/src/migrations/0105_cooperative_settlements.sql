-- =============================================================================
-- Migration 0105 - Cooperative settlement workflow.
--
-- Wave COOPERATIVE-SETTLEMENT. Cooperatives (FEMATA, REMATA, AMRI etc.)
-- collect aggregated production from member miners and need a transparent
-- period-end settlement: total revenue, levies, distributable, and
-- per-member share. This migration adds the two tables backing the
-- cooperative-settlement screen and the chat brain tools
-- (`cooperative.draft_settlement`, `member_share`,
-- `settlement_period_list`).
--
-- Tables:
--   * cooperative_settlement_periods    - one row per (cooperative, period)
--   * cooperative_member_distributions  - per-member breakdown within a period
--
-- Tenant scope:
--   tenant_id::text = current_setting('app.current_tenant_id', true)
--
-- RLS FORCE-enabled per CLAUDE.md. Money path STILL goes via
-- `LedgerService.post()` on distribute. Idempotent. Forward-only.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- cooperative_settlement_periods
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cooperative_settlement_periods (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid        NOT NULL,
  cooperative_party_id     uuid        NOT NULL,
  period_start             date        NOT NULL,
  period_end               date        NOT NULL,
  total_volume_kg          numeric(14, 3) NOT NULL DEFAULT 0,
  total_revenue_tzs        numeric(18, 2) NOT NULL DEFAULT 0,
  levies_tzs               numeric(18, 2) NOT NULL DEFAULT 0,
  net_distributable_tzs    numeric(18, 2) NOT NULL DEFAULT 0,
  status                   text        NOT NULL DEFAULT 'draft',
  approved_by_id           uuid,
  approved_at              timestamptz,
  distributed_at           timestamptz,
  four_eye_request_id      uuid,
  provenance               jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_hash_id            text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cooperative_settlement_periods_status_chk'
  ) THEN
    ALTER TABLE cooperative_settlement_periods
      ADD CONSTRAINT cooperative_settlement_periods_status_chk
      CHECK (status IN ('draft', 'calculated', 'approved', 'distributed', 'contested'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cooperative_settlement_periods_dates_chk'
  ) THEN
    ALTER TABLE cooperative_settlement_periods
      ADD CONSTRAINT cooperative_settlement_periods_dates_chk
      CHECK (period_end >= period_start);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cooperative_settlement_periods_tenant_uq'
  ) THEN
    ALTER TABLE cooperative_settlement_periods
      ADD CONSTRAINT cooperative_settlement_periods_tenant_uq
      UNIQUE (tenant_id, cooperative_party_id, period_start, period_end);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cooperative_settlement_periods_tenant_status
  ON cooperative_settlement_periods (tenant_id, status, period_end DESC);

ALTER TABLE cooperative_settlement_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE cooperative_settlement_periods FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'cooperative_settlement_periods'
       AND policyname = 'cooperative_settlement_periods_tenant_isolation'
  ) THEN
    CREATE POLICY cooperative_settlement_periods_tenant_isolation
      ON cooperative_settlement_periods
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- cooperative_member_distributions
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cooperative_member_distributions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  period_id           uuid        NOT NULL REFERENCES cooperative_settlement_periods(id) ON DELETE CASCADE,
  member_party_id     uuid        NOT NULL,
  share_pct           numeric(7, 4) NOT NULL,
  amount_tzs          numeric(18, 2) NOT NULL,
  paid_at             timestamptz,
  payment_ref         text,
  audit_hash_id       text,
  provenance          jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cooperative_member_distributions_share_chk'
  ) THEN
    ALTER TABLE cooperative_member_distributions
      ADD CONSTRAINT cooperative_member_distributions_share_chk
      CHECK (share_pct >= 0 AND share_pct <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cooperative_member_distributions_period_member_uq'
  ) THEN
    ALTER TABLE cooperative_member_distributions
      ADD CONSTRAINT cooperative_member_distributions_period_member_uq
      UNIQUE (period_id, member_party_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cooperative_member_distributions_tenant_period
  ON cooperative_member_distributions (tenant_id, period_id);

ALTER TABLE cooperative_member_distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cooperative_member_distributions FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'cooperative_member_distributions'
       AND policyname = 'cooperative_member_distributions_tenant_isolation'
  ) THEN
    CREATE POLICY cooperative_member_distributions_tenant_isolation
      ON cooperative_member_distributions
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
