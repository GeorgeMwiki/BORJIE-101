-- =============================================================================
-- Migration 0019 — Document Composition schema (Wave 17D)
--
-- Companion to docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md. Adds the
-- persistence substrate for Mr. Mwikila's 11-class document composer
-- + brand-locked renderer + lock/improve evolution loop:
--
--   1. document_recipes        — versioned recipe registry (global).
--                                Closed set of 11 DocumentClass values.
--   2. document_artifacts      — produced artefacts with checksum,
--                                span_citations, audit_hash, and
--                                Tier-2 approval state. Tenant-scoped.
--   3. doc_evolution_proposals — owner-facing improvement queue mirror
--                                of the UX layer's evolution proposals.
--                                Tenant-scoped.
--   4. doc_feedback_events     — acceptance/revision/rejection signals
--                                consumed by services/doc-evolution-worker.
--                                Tenant-scoped via artifact_id parent.
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
-- 1. document_recipes — versioned recipe registry (global)
-- -----------------------------------------------------------------------------
-- Recipes are product-wide config, like tab_recipes. Live recipes never
-- mutate in place — improvement proposals create version n+1 in shadow
-- state, promoted to live only after owner approval.

CREATE TABLE IF NOT EXISTS document_recipes (
  id                  text NOT NULL,
  version             integer NOT NULL,
  status              text NOT NULL,
  class               text NOT NULL,
  compose_fn_ref      text NOT NULL,
  required_inputs     jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_citations  jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_formats      text[] NOT NULL DEFAULT ARRAY[]::text[],
  authority_tier      smallint NOT NULL,
  brand               text NOT NULL DEFAULT 'borjie',
  approval_required   boolean NOT NULL DEFAULT true,
  promoted_at         timestamptz,
  promoted_by         text REFERENCES users(id) ON DELETE SET NULL,
  locked_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version),
  CONSTRAINT document_recipes_brand_chk CHECK (brand = 'borjie'),
  CONSTRAINT document_recipes_authority_chk CHECK (authority_tier IN (0,1,2)),
  CONSTRAINT document_recipes_status_chk
    CHECK (status IN ('draft','shadow','live','locked','deprecated')),
  CONSTRAINT document_recipes_class_chk
    CHECK (class IN (
      'daily_briefing','board_report','investor_briefing',
      'tumemadini_return','nemc_filing','buyer_kyb_pack',
      'sop','financial_model','contract',
      'geological_report','marketplace_listing'
    ))
);

CREATE INDEX IF NOT EXISTS document_recipes_status_idx ON document_recipes(status);
CREATE INDEX IF NOT EXISTS document_recipes_class_idx ON document_recipes(class);
CREATE INDEX IF NOT EXISTS document_recipes_live_idx
  ON document_recipes(id, version) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS document_recipes_promoted_by_idx
  ON document_recipes(promoted_by);

-- document_recipes is global product config — RLS off, service-account write.
ALTER TABLE document_recipes DISABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. document_artifacts — produced artefacts with audit chain + approval
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS document_artifacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipe_id       text NOT NULL,
  recipe_version  integer NOT NULL,
  format          text NOT NULL,
  storage_key     text NOT NULL,
  checksum        text NOT NULL,
  span_citations  jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_hash      text NOT NULL,
  approval_state  text NOT NULL DEFAULT 'pending',
  approved_by     text REFERENCES users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_artifacts_format_chk
    CHECK (format IN ('pdf','docx','pptx','xlsx','md','html')),
  CONSTRAINT document_artifacts_approval_chk
    CHECK (approval_state IN ('pending','approved','rejected','auto_published')),
  CONSTRAINT document_artifacts_recipe_fk
    FOREIGN KEY (recipe_id, recipe_version)
    REFERENCES document_recipes(id, version)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS document_artifacts_recipe_idx
  ON document_artifacts(recipe_id, recipe_version);
CREATE INDEX IF NOT EXISTS document_artifacts_tenant_generated_idx
  ON document_artifacts(tenant_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS document_artifacts_approval_idx
  ON document_artifacts(approval_state, generated_at DESC);
CREATE INDEX IF NOT EXISTS document_artifacts_pending_idx
  ON document_artifacts(tenant_id, generated_at DESC)
  WHERE approval_state = 'pending';
CREATE INDEX IF NOT EXISTS document_artifacts_audit_hash_idx
  ON document_artifacts(audit_hash);
CREATE INDEX IF NOT EXISTS document_artifacts_approved_by_idx
  ON document_artifacts(approved_by);

-- -----------------------------------------------------------------------------
-- 3. doc_evolution_proposals — owner-facing improvement queue
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS doc_evolution_proposals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipe_id             text NOT NULL,
  current_version       integer NOT NULL,
  proposed_version      integer NOT NULL,
  proposed_diff         jsonb NOT NULL,
  signals               jsonb NOT NULL DEFAULT '{}'::jsonb,
  citations             text[] NOT NULL DEFAULT ARRAY[]::text[],
  status                text NOT NULL DEFAULT 'pending',
  proposed_at           timestamptz NOT NULL DEFAULT now(),
  reviewed_at           timestamptz,
  reviewed_by           text REFERENCES users(id) ON DELETE SET NULL,
  reviewer_reason       text,
  approval_audit_hash   text,
  CONSTRAINT doc_evolution_proposals_status_chk
    CHECK (status IN ('pending','approved','rejected','expired')),
  CONSTRAINT doc_evolution_proposals_version_chk
    CHECK (proposed_version > current_version)
);

CREATE INDEX IF NOT EXISTS doc_evolution_proposals_status_recipe_idx
  ON doc_evolution_proposals(status, recipe_id);
CREATE INDEX IF NOT EXISTS doc_evolution_proposals_tenant_status_idx
  ON doc_evolution_proposals(tenant_id, status, proposed_at DESC);
CREATE INDEX IF NOT EXISTS doc_evolution_proposals_pending_idx
  ON doc_evolution_proposals(tenant_id, proposed_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS doc_evolution_proposals_reviewed_by_idx
  ON doc_evolution_proposals(reviewed_by);

-- -----------------------------------------------------------------------------
-- 4. doc_feedback_events — signals consumed by doc-evolution-worker
-- -----------------------------------------------------------------------------
-- artifact_id is the parent; tenant_id is denormalised here so that
-- the worker's nightly aggregation queries don't need a join (matches
-- the existing pattern used by junior_outputs migration).

CREATE TABLE IF NOT EXISTS doc_feedback_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id     uuid NOT NULL REFERENCES document_artifacts(id) ON DELETE CASCADE,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feedback_kind   text NOT NULL,
  section_path    text,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doc_feedback_events_kind_chk
    CHECK (feedback_kind IN (
      'accepted','revised','rejected','regulator_flag',
      'owner_rewrite','time_to_approve','submit_failure'
    ))
);

CREATE INDEX IF NOT EXISTS doc_feedback_events_artifact_kind_idx
  ON doc_feedback_events(artifact_id, feedback_kind);
CREATE INDEX IF NOT EXISTS doc_feedback_events_tenant_recorded_idx
  ON doc_feedback_events(tenant_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS doc_feedback_events_kind_recorded_idx
  ON doc_feedback_events(feedback_kind, recorded_at DESC);

-- -----------------------------------------------------------------------------
-- 5. Row Level Security — tenant-scoped tables
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'document_artifacts',
    'doc_evolution_proposals',
    'doc_feedback_events'
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
-- End of migration 0019_document_composition.sql
-- =============================================================================
