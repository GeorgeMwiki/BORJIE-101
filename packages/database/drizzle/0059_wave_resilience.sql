-- =============================================================================
-- Migration 0029 — Wave Resilience (Wave 18DD)
--
-- Spec: Docs/DESIGN/AGENT_SELF_REVIVAL_SPEC.md
--
-- Platform-level orchestration tables for the wave-resilience-manager
-- service. No tenant scoping (RLS) — these tables track orchestration
-- health, not customer data. Access is restricted at the application
-- layer by API key.
--
-- Two tables:
--   1. wave_progress — append-only per-checkpoint ledger
--   2. wave_revival_attempts — one row per (wave_id, attempt_number)
--
-- All ALTER TABLE additions use IF NOT EXISTS so the migration is
-- idempotent — re-runs against an already-migrated cluster are a
-- no-op.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. wave_progress — append-only per-checkpoint ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wave_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_id text NOT NULL,
  agent_id text NOT NULL,
  tenant_id text,
  status text NOT NULL DEFAULT 'dispatched',
  checkpoint_seq integer NOT NULL DEFAULT 0,
  checkpoint_label text,
  checkpoint_payload jsonb,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  attempt_number integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  audit_hash text NOT NULL,
  CONSTRAINT wave_progress_status_chk CHECK (status IN (
    'dispatched','running','checkpoint','completed',
    'crashed','revivable','resuming','unrecoverable'
  ))
);

CREATE INDEX IF NOT EXISTS idx_wp_wave_recent
  ON wave_progress (wave_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wp_status
  ON wave_progress (status, heartbeat_at);

COMMENT ON TABLE wave_progress IS
  'Wave 18DD — durable per-checkpoint ledger for agent waves. Append-only. Sealed via @borjie/audit-hash-chain.';

-- -----------------------------------------------------------------------------
-- 2. wave_revival_attempts — one row per revival attempt
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wave_revival_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_id text NOT NULL,
  attempt_number integer NOT NULL,
  original_dispatch_at timestamptz NOT NULL,
  crashed_at timestamptz NOT NULL,
  resumed_at timestamptz,
  completed_at timestamptz,
  outcome text,
  audit_hash text NOT NULL,
  CONSTRAINT wave_revival_attempts_outcome_chk CHECK (
    outcome IS NULL OR outcome IN ('completed','crashed_again','gave_up')
  ),
  CONSTRAINT wave_revival_attempts_unique UNIQUE (wave_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_wra_wave
  ON wave_revival_attempts (wave_id, attempt_number);

COMMENT ON TABLE wave_revival_attempts IS
  'Wave 18DD — one row per (wave_id, attempt_number). Tracks the lifecycle of each automated revival attempt.';

COMMIT;
