-- =============================================================================
-- Migration 0032 — Wave Resilience daily revival-attempt counter
--                 (Wave 18DD-config, founder decision #5)
--
-- Spec: Docs/DESIGN/AGENT_SELF_REVIVAL_SPEC.md — "Founder-locked
-- configuration" section.
--
-- Adds a single table that tracks per-day, per-tenant revival-attempt
-- totals so the resilience manager can enforce a platform-wide
-- budget (default 50/day) on top of the per-wave 3-attempt cap.
--
-- Composite primary key on (attempted_on, tenant_id_norm) where
-- `tenant_id_norm` is a generated column collapsing NULL → '' so
-- the platform-wide aggregate (tenant_id IS NULL) has a stable PK.
--
-- Idempotent: re-runs against an already-migrated cluster are a no-op.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS daily_revival_counters (
  attempted_on date NOT NULL,
  tenant_id text,
  tenant_id_norm text GENERATED ALWAYS AS (COALESCE(tenant_id, '')) STORED,
  attempt_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_revival_counters_pk
    PRIMARY KEY (attempted_on, tenant_id_norm),
  CONSTRAINT daily_revival_counters_count_nonneg
    CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_drc_today
  ON daily_revival_counters (attempted_on DESC);

COMMENT ON TABLE daily_revival_counters IS
  'Wave 18DD-config — per-day per-tenant revival-attempt counter for the platform-wide daily budget (founder decision #5). tenant_id IS NULL = platform-wide aggregate row.';

COMMIT;
