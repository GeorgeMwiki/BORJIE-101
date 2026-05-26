-- =============================================================================
-- Migration 0017 — Anticipatory UX schema (Wave 17B)
--
-- Companion to docs/DESIGN/ANTICIPATORY_UX_SPEC.md. Adds the persistence
-- substrate for Mr. Mwikila's dynamic-UI composer + brand-locked renderer
-- + continuous UX optimization loop:
--
--   1. tab_recipes             — versioned, immutable Tab Recipe registry.
--                                Global (no tenant scope) — recipes are
--                                product-wide. RLS disabled.
--   2. ui_telemetry_events     — append-only per-field interaction trace.
--                                Tenant-scoped, scrubbed of PII (only
--                                field IDs + event kinds).
--   3. ui_evolution_proposals  — owner-facing UI improvement queue.
--                                Tenant-scoped.
--   4. brand_lint_violations   — nightly CI sweep + runtime validator
--                                output. Global (not tenant-scoped).
--                                RLS disabled.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration 0003.
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. tab_recipes — versioned Tab Recipe registry
-- -----------------------------------------------------------------------------
-- Every (id, version) is immutable once status='live'. Promotions go
-- via `proposed_version` → `live` → optionally `locked`. The composer
-- function is referenced by module path so worker bootstraps lazily.

CREATE TABLE IF NOT EXISTS tab_recipes (
  id              text NOT NULL,
  version         integer NOT NULL,
  status          text NOT NULL,
  intent          text NOT NULL,
  compose_fn_ref  text NOT NULL,
  authority_tier  smallint NOT NULL,
  brand           text NOT NULL DEFAULT 'borjie',
  promoted_at     timestamptz,
  promoted_by     text REFERENCES users(id) ON DELETE SET NULL,
  locked_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version),
  CONSTRAINT tab_recipes_brand_chk CHECK (brand = 'borjie'),
  CONSTRAINT tab_recipes_authority_chk CHECK (authority_tier IN (0,1,2)),
  CONSTRAINT tab_recipes_status_chk
    CHECK (status IN ('draft','shadow','live','locked','deprecated'))
);

CREATE INDEX IF NOT EXISTS tab_recipes_status_idx ON tab_recipes(status);
CREATE INDEX IF NOT EXISTS tab_recipes_intent_idx ON tab_recipes(intent);
CREATE INDEX IF NOT EXISTS tab_recipes_promoted_by_idx
  ON tab_recipes(promoted_by);
CREATE INDEX IF NOT EXISTS tab_recipes_live_idx
  ON tab_recipes(id, version) WHERE status = 'live';

-- tab_recipes is global product config — RLS off, but only the service
-- account can write (enforced at the API layer).
ALTER TABLE tab_recipes DISABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. ui_telemetry_events — append-only field interaction stream
-- -----------------------------------------------------------------------------
-- Consumed by services/ui-evolution-worker on a 14-day rolling window.
-- `payload` is scrubbed of field values; only field IDs + event kinds.

CREATE TABLE IF NOT EXISTS ui_telemetry_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tab_recipe_id       text NOT NULL,
  tab_recipe_version  integer NOT NULL,
  session_id          text,
  field_id            text,
  event_kind          text NOT NULL,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ui_telemetry_events_kind_chk
    CHECK (event_kind IN (
      'focus','blur','change','error','tooltip_hit','abandon','submit',
      'render','dismiss'
    ))
);

CREATE INDEX IF NOT EXISTS ui_telemetry_events_recipe_idx
  ON ui_telemetry_events(tab_recipe_id, tab_recipe_version, recorded_at DESC);
CREATE INDEX IF NOT EXISTS ui_telemetry_events_tenant_recorded_idx
  ON ui_telemetry_events(tenant_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS ui_telemetry_events_field_idx
  ON ui_telemetry_events(tab_recipe_id, tab_recipe_version, field_id, event_kind);
CREATE INDEX IF NOT EXISTS ui_telemetry_events_session_idx
  ON ui_telemetry_events(session_id) WHERE session_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. ui_evolution_proposals — owner-facing UI improvement queue
-- -----------------------------------------------------------------------------
-- Created by services/ui-evolution-worker. Owner approves / rejects via
-- the apps/owner-web Anticipatory UX review panel.

CREATE TABLE IF NOT EXISTS ui_evolution_proposals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tab_recipe_id          text NOT NULL,
  current_version        integer NOT NULL,
  proposed_version       integer NOT NULL,
  proposed_schema_diff   jsonb NOT NULL,
  signals                jsonb NOT NULL DEFAULT '{}'::jsonb,
  citations              text[] NOT NULL DEFAULT ARRAY[]::text[],
  status                 text NOT NULL DEFAULT 'pending',
  proposed_at            timestamptz NOT NULL DEFAULT now(),
  reviewed_at            timestamptz,
  reviewed_by            text REFERENCES users(id) ON DELETE SET NULL,
  reviewer_reason        text,
  rollout_strategy       text,
  approval_audit_hash    text,
  CONSTRAINT ui_evolution_proposals_status_chk
    CHECK (status IN ('pending','approved','rejected','expired','auto_applied_tier_0')),
  CONSTRAINT ui_evolution_proposals_rollout_chk
    CHECK (rollout_strategy IS NULL
      OR rollout_strategy IN ('gradual','full','a_b')),
  CONSTRAINT ui_evolution_proposals_version_chk
    CHECK (proposed_version > current_version)
);

CREATE INDEX IF NOT EXISTS ui_evolution_proposals_tenant_status_idx
  ON ui_evolution_proposals(tenant_id, status, proposed_at DESC);
CREATE INDEX IF NOT EXISTS ui_evolution_proposals_recipe_idx
  ON ui_evolution_proposals(tab_recipe_id, current_version);
CREATE INDEX IF NOT EXISTS ui_evolution_proposals_pending_idx
  ON ui_evolution_proposals(tenant_id, proposed_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ui_evolution_proposals_reviewed_by_idx
  ON ui_evolution_proposals(reviewed_by);

-- -----------------------------------------------------------------------------
-- 4. brand_lint_violations — CI sweep + runtime validator output
-- -----------------------------------------------------------------------------
-- Populated by nightly repo sweep and the runtime brand-token validator.
-- Global (not tenant-scoped) — these are code-level lints surfaced to
-- the platform team weekly digest.

CREATE TABLE IF NOT EXISTS brand_lint_violations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path     text NOT NULL,
  line_no       integer NOT NULL,
  rule          text NOT NULL,
  snippet       text NOT NULL,
  detected_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_lint_violations_rule_chk
    CHECK (rule IN (
      'raw-color','inline-style','arbitrary-spacing','non-brand-font',
      'arbitrary-radius','arbitrary-shadow','non-token-class'
    ))
);

CREATE INDEX IF NOT EXISTS brand_lint_violations_file_idx
  ON brand_lint_violations(file_path);
CREATE INDEX IF NOT EXISTS brand_lint_violations_rule_idx
  ON brand_lint_violations(rule, detected_at DESC);
CREATE INDEX IF NOT EXISTS brand_lint_violations_detected_idx
  ON brand_lint_violations(detected_at DESC);

-- brand_lint_violations is global ops tooling — RLS off.
ALTER TABLE brand_lint_violations DISABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 5. Row Level Security — tenant-scoped tables only
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ui_telemetry_events',
    'ui_evolution_proposals'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (tenant_id = current_setting(''app.tenant_id'', true));',
      t
    );
  END LOOP;
END$$;

COMMIT;

-- =============================================================================
-- End of migration 0017_anticipatory_ux.sql
-- =============================================================================
