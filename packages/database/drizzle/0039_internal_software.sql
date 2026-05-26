-- =============================================================================
-- Migration 0039 — On-Demand Internal Software (Wave M8-M9)
--
-- Companion to Docs/DESIGN/ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md.
--
-- The owner says "I want a tool that scans worker shift logs for missed
-- safety steps." Mr. Mwikila generates a tiny purpose-built ephemeral
-- tool (form schema + handler function + dashboard archetype + audit
-- hook), runs it, presents results, archives it. Each generated tool
-- is a sealed bundle.
--
-- Two tables:
--
--   1. internal_tools     — registry of generated tools. Stores name,
--                            kind (report | workflow | dashboard |
--                            extractor | watcher), the immutable spec
--                            (jsonb: form schema, handler signature,
--                            archetype, etc.), the lifecycle state
--                            (draft → staged → live → archived),
--                            the authority tier (T1 default; T2 if
--                            mutating or scope-crossing), and audit
--                            hash chain pointers.
--
--   2. internal_tool_runs — one row per tool execution. Stores the
--                            inputs (jsonb), the outputs (jsonb),
--                            the actor (ran_by uuid), and the audit
--                            hash for forensic replay.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. internal_tools — registry of MD-generated tools
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS internal_tools (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL,
  name             text NOT NULL,
  kind             text NOT NULL,
  spec             jsonb NOT NULL,
  lifecycle_state  text NOT NULL DEFAULT 'draft',
  authority_tier   text NOT NULL DEFAULT 'T1',
  created_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,
  audit_hash       text NOT NULL,
  prev_hash        text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'internal_tools_kind_chk'
  ) THEN
    ALTER TABLE internal_tools
      ADD CONSTRAINT internal_tools_kind_chk
      CHECK (kind IN (
        'report', 'workflow', 'dashboard', 'extractor', 'watcher'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'internal_tools_lifecycle_chk'
  ) THEN
    ALTER TABLE internal_tools
      ADD CONSTRAINT internal_tools_lifecycle_chk
      CHECK (lifecycle_state IN ('draft', 'staged', 'live', 'archived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'internal_tools_authority_chk'
  ) THEN
    ALTER TABLE internal_tools
      ADD CONSTRAINT internal_tools_authority_chk
      CHECK (authority_tier IN ('T1', 'T2'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_internal_tools_tenant_live
  ON internal_tools (tenant_id, lifecycle_state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_tools_kind
  ON internal_tools (tenant_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_tools_audit_hash
  ON internal_tools (audit_hash);

ALTER TABLE internal_tools ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'internal_tools'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON internal_tools
      USING (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. internal_tool_runs — per-execution ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS internal_tool_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id      uuid NOT NULL REFERENCES internal_tools(id) ON DELETE CASCADE,
  tenant_id    text NOT NULL,
  inputs       jsonb NOT NULL DEFAULT '{}'::jsonb,
  outputs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ran_by       uuid NOT NULL,
  ran_at       timestamptz NOT NULL DEFAULT now(),
  audit_hash   text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_internal_tool_runs_tool
  ON internal_tool_runs (tool_id, ran_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_tool_runs_tenant
  ON internal_tool_runs (tenant_id, ran_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_tool_runs_audit_hash
  ON internal_tool_runs (audit_hash);

ALTER TABLE internal_tool_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'internal_tool_runs'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON internal_tool_runs
      USING (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
