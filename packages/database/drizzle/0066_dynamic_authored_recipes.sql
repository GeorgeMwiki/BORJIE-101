-- =============================================================================
-- Migration 0066 — Dynamic Authored Recipes (Wave 18M)
--
-- Companion to Docs/DESIGN/DYNAMIC_RECIPE_AUTHORING_SPEC.md.
--
-- The owner says "I want a tab that shows pit safety KPIs broken by shift"
-- and Mr. Mwikila authors a NEW recipe (tab, doc, media, campaign, or
-- internal tool) via the LLM-driven authoring pipeline in
-- @borjie/dynamic-recipe-authoring. The authored spec is validated
-- against the existing contract from Wave 18B (`@borjie/dynamic-ui`)
-- or Wave 18C (`@borjie/document-templates`) and persisted here as a
-- draft, then promoted through draft → shadow → live → locked → deprecated.
--
-- One table:
--
--   dynamic_authored_recipes — versioned, tenant-scoped, lifecycle-
--                              governed registry of LLM-authored recipes.
--                              Each row carries the validated spec as a
--                              jsonb payload plus an audit hash chained
--                              against the prior authored recipe in the
--                              tenant's chain.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration 0003.
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- dynamic_authored_recipes — LLM-authored, lifecycle-governed recipe registry
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dynamic_authored_recipes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL,
  /** Recipe kind: tab | doc | media | campaign | tool. */
  kind             text NOT NULL,
  /** Human-friendly name supplied by the operator or derived from the
      utterance. */
  name             text NOT NULL,
  /** Semver-ish version string (e.g. '0.1.0'). New authored versions
      append a new row rather than mutating in place. */
  version          text NOT NULL,
  /** The validated, frozen spec — shape depends on `kind`. */
  spec             jsonb NOT NULL,
  /** draft → shadow → live → locked → deprecated. */
  lifecycle_state  text NOT NULL DEFAULT 'draft',
  authored_at      timestamptz NOT NULL DEFAULT now(),
  /** 'mr-mwikila' for LLM-authored, or 'tenant-user:<uuid>' for
      operator-direct authoring. */
  authored_by      text NOT NULL,
  /** Hash of the previous authored-recipe row in this tenant's chain.
      Empty string for the genesis row. */
  prev_hash        text NOT NULL DEFAULT '',
  audit_hash       text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dynamic_authored_recipes_kind_chk'
  ) THEN
    ALTER TABLE dynamic_authored_recipes
      ADD CONSTRAINT dynamic_authored_recipes_kind_chk
      CHECK (kind IN ('tab','doc','media','campaign','tool'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dynamic_authored_recipes_lifecycle_chk'
  ) THEN
    ALTER TABLE dynamic_authored_recipes
      ADD CONSTRAINT dynamic_authored_recipes_lifecycle_chk
      CHECK (lifecycle_state IN (
        'draft','shadow','live','locked','deprecated'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dynamic_authored_recipes_name_nonempty_chk'
  ) THEN
    ALTER TABLE dynamic_authored_recipes
      ADD CONSTRAINT dynamic_authored_recipes_name_nonempty_chk
      CHECK (length(name) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dynamic_authored_recipes_version_nonempty_chk'
  ) THEN
    ALTER TABLE dynamic_authored_recipes
      ADD CONSTRAINT dynamic_authored_recipes_version_nonempty_chk
      CHECK (length(version) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dynamic_authored_recipes_authored_by_nonempty_chk'
  ) THEN
    ALTER TABLE dynamic_authored_recipes
      ADD CONSTRAINT dynamic_authored_recipes_authored_by_nonempty_chk
      CHECK (length(authored_by) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dynamic_authored_recipes_audit_hash_nonempty_chk'
  ) THEN
    ALTER TABLE dynamic_authored_recipes
      ADD CONSTRAINT dynamic_authored_recipes_audit_hash_nonempty_chk
      CHECK (length(audit_hash) > 0);
  END IF;
END $$;

-- One row per (tenant, kind, name, version). Re-authoring a recipe at
-- a new version appends a new row; collisions on the same version are
-- rejected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dynamic_authored_recipes_unique_version
  ON dynamic_authored_recipes (tenant_id, kind, name, version);

-- Hot path: list a tenant's authored recipes by kind + lifecycle.
CREATE INDEX IF NOT EXISTS idx_dynamic_authored_recipes_tenant_kind_lifecycle
  ON dynamic_authored_recipes (tenant_id, kind, lifecycle_state, authored_at DESC);

-- Forensic replay path.
CREATE INDEX IF NOT EXISTS idx_dynamic_authored_recipes_audit_hash
  ON dynamic_authored_recipes (audit_hash);

ALTER TABLE dynamic_authored_recipes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'dynamic_authored_recipes'
       AND policyname = 'dynamic_authored_recipes_tenant_isolation'
  ) THEN
    CREATE POLICY dynamic_authored_recipes_tenant_isolation
      ON dynamic_authored_recipes
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
