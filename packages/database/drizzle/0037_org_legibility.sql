-- =============================================================================
-- Migration 0037 — Org Legibility Map (Wave M6)
--
-- Spec: Docs/DESIGN/ORG_LEGIBILITY_SPEC.md §14-21
--
-- Persists the live, queryable, brand-locked org legibility map: who
-- owns which mine, which juniors are assigned where, what's in flight,
-- what capabilities are live. Two refresh paths feed the same store:
-- event-driven (sub-second) deltas and a 5-min reconciliation snapshot.
--
-- Two tables:
--   1. legibility_snapshots  — one row per (tenant, scope, snapshot_at).
--                                The reconciled, authoritative
--                                LegibilityMap envelope. Persona-safe
--                                (juniors only in `internal_snapshot`).
--   2. legibility_deltas     — one row per event-driven delta. Applied
--                                forward from the previous snapshot
--                                to rebuild the latest state.
--
-- Both tables are tenant-scoped and use the canonical
-- `current_setting('app.tenant_id', true)` GUC RLS pattern.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. legibility_snapshots — reconciled authoritative map
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS legibility_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  scope_id            text NOT NULL,
  snapshot_at         timestamptz NOT NULL DEFAULT now(),
  snapshot            jsonb NOT NULL,
  internal_snapshot   jsonb,
  axes                text[] NOT NULL DEFAULT ARRAY[
    'people','roles','scopes','capabilities','currentWork'
  ]::text[],
  audit_hash          text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_legibility_snapshots_scope
  ON legibility_snapshots (tenant_id, scope_id, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_legibility_snapshots_recent
  ON legibility_snapshots (tenant_id, snapshot_at DESC);

ALTER TABLE legibility_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legibility_snapshots_tenant_read ON legibility_snapshots;
CREATE POLICY legibility_snapshots_tenant_read ON legibility_snapshots
  USING (tenant_id = current_setting('app.tenant_id', true));

-- -----------------------------------------------------------------------------
-- 2. legibility_deltas — event-driven map deltas
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS legibility_deltas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      text NOT NULL,
  scope_id       text NOT NULL,
  delta_kind     text NOT NULL,
  payload        jsonb NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  audit_hash     text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'legibility_deltas_kind_chk'
  ) THEN
    ALTER TABLE legibility_deltas
      ADD CONSTRAINT legibility_deltas_kind_chk
      CHECK (delta_kind IN (
        'person.added',
        'person.removed',
        'role.granted',
        'role.revoked',
        'scope.added',
        'scope.archived',
        'capability.activated',
        'capability.retired',
        'work.started',
        'work.completed',
        'work.blocked',
        'junior.assigned',
        'junior.released',
        'reconciliation.divergence'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_legibility_deltas_scope
  ON legibility_deltas (tenant_id, scope_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_legibility_deltas_kind
  ON legibility_deltas (tenant_id, delta_kind, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_legibility_deltas_recent
  ON legibility_deltas (tenant_id, recorded_at DESC);

ALTER TABLE legibility_deltas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legibility_deltas_tenant_read ON legibility_deltas;
CREATE POLICY legibility_deltas_tenant_read ON legibility_deltas
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMIT;
