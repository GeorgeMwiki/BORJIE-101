-- =============================================================================
-- Migration 0033 — Continuous 24/7 Work Cycle (Wave M1)
--
-- Companion to docs/DESIGN/CONTINUOUS_24_7_WORK_CYCLE_SPEC.md. Adds the
-- persistence substrate for Mr. Mwikila's continuous 24/7 work loop:
--
--   1. work_cycle_journal — append-only journal of every tick. Hash-
--                            chained via (prev_hash, audit_hash). One
--                            row per tick. Tenant-scoped, RLS-bound.
--   2. work_cycle_state   — one row per tenant. Holds last_tick_no,
--                            last_tick_at, current_mode, pending_threads.
--                            Tenant-scoped, RLS-bound.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migrations
-- 0003 and 0029. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. work_cycle_journal — append-only journal of every tick
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS work_cycle_journal (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  tick_no         bigint NOT NULL,
  started_at      timestamptz NOT NULL,
  ended_at        timestamptz NOT NULL,
  mode            text NOT NULL,
  inputs          jsonb NOT NULL,
  outputs         jsonb NOT NULL,
  cost_usd_cents  integer NOT NULL DEFAULT 0,
  audit_hash      text NOT NULL,
  prev_hash       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wcj_mode_known CHECK (mode IN ('idle','active','night','observe')),
  CONSTRAINT wcj_cost_nonneg CHECK (cost_usd_cents >= 0),
  CONSTRAINT wcj_tick_nonneg CHECK (tick_no >= 0)
);

-- Per-tenant tick monotonicity. The composite unique constraint is the
-- idempotency anchor — a re-run of a crashed worker rejects rather than
-- duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wcj_tenant_tick
  ON work_cycle_journal (tenant_id, tick_no);

CREATE INDEX IF NOT EXISTS idx_wcj_tenant_started
  ON work_cycle_journal (tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_wcj_tenant_mode
  ON work_cycle_journal (tenant_id, mode, started_at DESC);

ALTER TABLE work_cycle_journal ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'work_cycle_journal'
       AND policyname = 'wcj_tenant_isolation'
  ) THEN
    CREATE POLICY wcj_tenant_isolation ON work_cycle_journal
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. work_cycle_state — one row per tenant, holds resumption pointer
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS work_cycle_state (
  tenant_id        text PRIMARY KEY,
  last_tick_no     bigint NOT NULL DEFAULT 0,
  last_tick_at     timestamptz,
  current_mode     text NOT NULL DEFAULT 'idle',
  pending_threads  jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wcs_mode_known CHECK (current_mode IN ('idle','active','night','observe')),
  CONSTRAINT wcs_tick_nonneg CHECK (last_tick_no >= 0)
);

CREATE INDEX IF NOT EXISTS idx_wcs_last_tick_at
  ON work_cycle_state (last_tick_at DESC);

ALTER TABLE work_cycle_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'work_cycle_state'
       AND policyname = 'wcs_tenant_isolation'
  ) THEN
    CREATE POLICY wcs_tenant_isolation ON work_cycle_state
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

COMMIT;
