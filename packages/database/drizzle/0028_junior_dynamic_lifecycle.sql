-- =============================================================================
-- Migration 0028 — Junior Dynamic Lifecycle (Wave 18V-DYNAMIC)
--
-- Spec: Docs/DESIGN/JUNIOR_DYNAMIC_SPAWNING_SPEC.md
--
-- This migration extends the Wave 18V `junior_personas` table with:
--   - provenance discriminator (seed | spawned | tenant_authored)
--   - lifecycle_status discriminator (draft | shadow | live | locked | deprecated)
--   - usage + satisfaction metrics
--   - spawn provenance (user_id + source turn id)
--   - lifecycle transition timestamps
--   - tenant_id (NULL for seed; required for spawned + tenant_authored)
--
-- It also creates `junior_turn_feedback` — one row per turn-level
-- feedback signal, RLS-bound by tenant_id. The lifecycle worker reads
-- this table to compute rolling-window satisfaction averages.
--
-- All ALTER TABLE additions use IF NOT EXISTS so the migration is
-- idempotent — re-runs against an already-migrated cluster are a
-- no-op.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Extend junior_personas
-- -----------------------------------------------------------------------------

ALTER TABLE junior_personas
  ADD COLUMN IF NOT EXISTS provenance text NOT NULL DEFAULT 'seed';

ALTER TABLE junior_personas
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'live';

ALTER TABLE junior_personas
  ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0;

ALTER TABLE junior_personas
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

ALTER TABLE junior_personas
  ADD COLUMN IF NOT EXISTS avg_satisfaction numeric(3,2);

ALTER TABLE junior_personas
  ADD COLUMN IF NOT EXISTS spawned_by_user_id text;

ALTER TABLE junior_personas
  ADD COLUMN IF NOT EXISTS spawned_from_turn_id uuid;

ALTER TABLE junior_personas
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz;

ALTER TABLE junior_personas
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

ALTER TABLE junior_personas
  ADD COLUMN IF NOT EXISTS deprecated_at timestamptz;

ALTER TABLE junior_personas
  ADD COLUMN IF NOT EXISTS tenant_id text;

-- Provenance + lifecycle constraints (separate from default for clarity).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'junior_personas_provenance_chk'
  ) THEN
    ALTER TABLE junior_personas
      ADD CONSTRAINT junior_personas_provenance_chk
      CHECK (provenance IN ('seed', 'spawned', 'tenant_authored'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'junior_personas_lifecycle_chk'
  ) THEN
    ALTER TABLE junior_personas
      ADD CONSTRAINT junior_personas_lifecycle_chk
      CHECK (lifecycle_status IN ('draft', 'shadow', 'live', 'locked', 'deprecated'));
  END IF;
END $$;

-- Backfill existing rows: they predate dynamic spawning so they are seed/live.
UPDATE junior_personas
SET provenance = 'seed'
WHERE provenance IS NULL OR provenance = '';

UPDATE junior_personas
SET lifecycle_status = 'live'
WHERE lifecycle_status IS NULL OR lifecycle_status = '';

-- Helpful index: list-by-tenant + lifecycle filter for the matcher.
CREATE INDEX IF NOT EXISTS junior_personas_tenant_lifecycle_idx
  ON junior_personas(tenant_id, lifecycle_status)
  WHERE tenant_id IS NOT NULL;

-- Lifecycle worker query: every tenant-scoped junior in shadow/live status.
CREATE INDEX IF NOT EXISTS junior_personas_lifecycle_provenance_idx
  ON junior_personas(provenance, lifecycle_status);

-- -----------------------------------------------------------------------------
-- 2. junior_turn_feedback — per-turn satisfaction signal
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS junior_turn_feedback (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  junior_id           text        NOT NULL,
  tenant_id           text        NOT NULL,
  turn_id             uuid        NOT NULL,
  satisfaction_score  numeric(3,2),
  feedback_kind       text        NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT junior_turn_feedback_kind_chk
    CHECK (feedback_kind IN ('explicit_positive', 'explicit_negative', 'implicit_completed', 'implicit_abandoned')),
  CONSTRAINT junior_turn_feedback_score_chk
    CHECK (satisfaction_score IS NULL OR (satisfaction_score >= 0 AND satisfaction_score <= 1))
);

CREATE INDEX IF NOT EXISTS junior_turn_feedback_junior_recorded_idx
  ON junior_turn_feedback(junior_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS junior_turn_feedback_tenant_idx
  ON junior_turn_feedback(tenant_id, recorded_at DESC);

-- -----------------------------------------------------------------------------
-- 3. RLS — tenant isolation on the feedback table
-- -----------------------------------------------------------------------------

ALTER TABLE junior_turn_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS junior_turn_feedback_tenant_read ON junior_turn_feedback;
CREATE POLICY junior_turn_feedback_tenant_read ON junior_turn_feedback
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS junior_turn_feedback_tenant_write ON junior_turn_feedback;
CREATE POLICY junior_turn_feedback_tenant_write ON junior_turn_feedback
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- -----------------------------------------------------------------------------
-- 4. Comments
-- -----------------------------------------------------------------------------

COMMENT ON COLUMN junior_personas.provenance IS
  'Wave 18V-DYNAMIC — seed (pre-registered in code), spawned (LLM-authored at runtime), tenant_authored (created via admin portal).';
COMMENT ON COLUMN junior_personas.lifecycle_status IS
  'Wave 18V-DYNAMIC — draft → shadow → live → locked → deprecated.';
COMMENT ON COLUMN junior_personas.tenant_id IS
  'Wave 18V-DYNAMIC — NULL for seed (global); REQUIRED for spawned + tenant_authored (enforced at the application layer to avoid blocking the backfill).';
COMMENT ON TABLE junior_turn_feedback IS
  'Wave 18V-DYNAMIC — per-turn satisfaction signal feeding the lifecycle worker. RLS-bound to tenant_id.';

COMMIT;
