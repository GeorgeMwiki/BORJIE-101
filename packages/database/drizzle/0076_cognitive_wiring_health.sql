-- =============================================================================
-- Migration 0076 — Cognitive Wiring Health (Wave NEURO-WIRING-SOTA, Phase 3)
--
-- Companion to:
--   - Docs/DESIGN/NEURO_WIRING_SOTA_2026.md (section 8 — migration design)
--   - Docs/QA/NEURO_DEPENDENCY_GRAPH_2026.md (Phase 1 audit)
--   - packages/cognitive-composition (composition root that emits these rows)
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- One table:
--
--   cognitive_wiring_health — one row per (tenant_id, wire_id) per observation
--                             window. Records whether each of the 33 wires
--                             (12 critical + 21 extra) fired in the window,
--                             with p95 latency, layer, and free-form notes.
--                             Hash-chained per (tenant_id) so the wiring
--                             history is forensic-replayable across audits.
--
-- Tenant-scoped via the canonical `current_setting('app.tenant_id', true)`
-- GUC RLS pattern from migration 0003 (re-used throughout the codebase).
--
-- 0075 deliberately skipped per Docs/DESIGN/NEURO_WIRING_SOTA_2026.md
-- section 8 (founder-locked migration-numbering decision).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- cognitive_wiring_health — the brain's continuous self-observation ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cognitive_wiring_health (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  /** Stable wire identifier, e.g. 'cognitive-engine->capability-catalogue'. */
  wire_id         text        NOT NULL,
  /** Did the wire fire at least once during this observation window? */
  fired           boolean     NOT NULL,
  /** p95 latency of the wire's invocations during the window, in milliseconds.
      NULL if the wire did not fire in the window. */
  latency_p95_ms  integer,
  /** Layer of the seven-layer brain DAG or 'spine' for cross-cutting wires.
      One of: 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'spine'. */
  layer           text        NOT NULL,
  /** Free-form structured diagnostic notes (e.g. last_error, fire_count,
      wire_kind: 'real' | 'stub' | 'mock'). */
  notes           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  /** Per-tenant hash chain over the wire-health rows for forensic replay. */
  audit_hash      text        NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cwh_tenant_nonempty_chk'
  ) THEN
    ALTER TABLE cognitive_wiring_health
      ADD CONSTRAINT cwh_tenant_nonempty_chk
      CHECK (length(tenant_id) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cwh_wire_id_nonempty_chk'
  ) THEN
    ALTER TABLE cognitive_wiring_health
      ADD CONSTRAINT cwh_wire_id_nonempty_chk
      CHECK (length(wire_id) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cwh_layer_chk'
  ) THEN
    ALTER TABLE cognitive_wiring_health
      ADD CONSTRAINT cwh_layer_chk
      CHECK (layer IN ('L1','L2','L3','L4','L5','L6','L7','spine'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cwh_latency_nonneg_chk'
  ) THEN
    ALTER TABLE cognitive_wiring_health
      ADD CONSTRAINT cwh_latency_nonneg_chk
      CHECK (latency_p95_ms IS NULL OR latency_p95_ms >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cwh_audit_hash_nonempty_chk'
  ) THEN
    ALTER TABLE cognitive_wiring_health
      ADD CONSTRAINT cwh_audit_hash_nonempty_chk
      CHECK (length(audit_hash) > 0);
  END IF;
END $$;

-- Hot path: list a tenant's wire health newest first for the operator dash.
CREATE INDEX IF NOT EXISTS idx_cwh_tenant_recorded_at
  ON cognitive_wiring_health (tenant_id, recorded_at DESC);

-- Per-wire history within a tenant.
CREATE INDEX IF NOT EXISTS idx_cwh_tenant_wire
  ON cognitive_wiring_health (tenant_id, wire_id, recorded_at DESC);

-- Layer-level rollups for the seven-layer pane.
CREATE INDEX IF NOT EXISTS idx_cwh_tenant_layer
  ON cognitive_wiring_health (tenant_id, layer, recorded_at DESC);

-- Forensic replay path — audit-hash lookup.
CREATE INDEX IF NOT EXISTS idx_cwh_audit_hash
  ON cognitive_wiring_health (audit_hash);

ALTER TABLE cognitive_wiring_health ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'cognitive_wiring_health'
       AND policyname = 'cwh_tenant_isolation'
  ) THEN
    CREATE POLICY cwh_tenant_isolation
      ON cognitive_wiring_health
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
