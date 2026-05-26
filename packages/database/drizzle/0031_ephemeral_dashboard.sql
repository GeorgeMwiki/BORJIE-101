-- =============================================================================
-- Migration 0031 — Ephemeral Dashboard Telemetry schema (ephemeral-software)
--
-- Companion to Docs/DESIGN/FUNCTION_ATTACHED_DASHBOARD_SPEC.md and
-- Docs/STRATEGY/EPHEMERAL_SOFTWARE_SOTA.md. Adds the SINGLE durable
-- trace for function-attached, ephemeral dashboards composed on demand
-- by @borjie/ephemeral-ui:
--
--   1. ephemeral_dashboard_telemetry
--        — one row per compose call. Stores the function id, manifest
--          version, generated recipe-shape hash, user + session +
--          tenant + scope, user-context hash (cache-key + replay
--          key), generation + close timestamps, reuse counts, and
--          promotion outcome. Tenant-scoped, RLS-bound.
--
-- TabRecipes themselves NEVER persist here — they live in process
-- memory + the LRU compose cache per FUNCTION_ATTACHED_DASHBOARD_SPEC
-- §6 (cache policy). This table is the audit trail + the promotion
-- decider's source of truth (§7).
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. ephemeral_dashboard_telemetry — compose-time audit + reuse counter
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ephemeral_dashboard_telemetry (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                         text NOT NULL,
  function_id                       text NOT NULL,
  manifest_version                  integer NOT NULL,
  generated_recipe_hash             text NOT NULL,
  user_id                           text NOT NULL,
  session_id                        uuid NOT NULL,
  scope_kind                        text,
  scope_id                          text,
  user_context_hash                 text NOT NULL,
  generated_at                      timestamptz NOT NULL DEFAULT now(),
  closed_at                         timestamptz,
  reuse_count_for_this_pattern      integer NOT NULL DEFAULT 0,
  distinct_user_count_for_pattern   integer NOT NULL DEFAULT 0,
  was_promoted                      boolean NOT NULL DEFAULT false,
  promotion_recipe_id               text,
  audit_hash                        text NOT NULL
);

-- Indexes — function-recent for telemetry queries, pattern-reuse for the
-- promotion decider's 10×3 lookup, tenant-scope for RLS-pre-filtering.
CREATE INDEX IF NOT EXISTS idx_edt_function_recent
  ON ephemeral_dashboard_telemetry (function_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_edt_pattern_reuse
  ON ephemeral_dashboard_telemetry (
    generated_recipe_hash,
    reuse_count_for_this_pattern DESC
  );

CREATE INDEX IF NOT EXISTS idx_edt_tenant_scope
  ON ephemeral_dashboard_telemetry (tenant_id, scope_id);

-- Row-level security — canonical tenant-isolation policy.
ALTER TABLE ephemeral_dashboard_telemetry ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'ephemeral_dashboard_telemetry'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON ephemeral_dashboard_telemetry
      USING (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END;
$$;

COMMIT;
