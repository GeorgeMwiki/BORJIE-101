-- =============================================================================
-- Migration 0008 — Admin internals (decision-log / SLO / killswitch read /
-- promotions / regulator-pipeline / citations / compliance-queue).
--
-- Three NEW platform-scope tables backing the Borjie HQ admin console
-- (`apps/admin-web`). The other four admin endpoints reuse existing
-- tables (`decision_traces`, `audit_events`, `intelligence_corpus_chunks`,
-- `platform_killswitch_state`, `kernel_prompt_registry`, `ai_cost_entries`).
--
--   1. regulator_pipeline_entries — kanban-shaped regulator change tracker
--      (Gazette / NEMC / Tumemadini / BoT / TRA captures + push-to-corpus).
--   2. prompt_promotions          — prompt/model/corpus version promotion
--      history with revert metadata, surfaced by the rollback UI.
--   3. compliance_escalations     — escalations raised by the Compliance
--      Agent that require platform-staff triage; severity + tenant-scoped.
--
-- All three are PLATFORM-SCOPED rows (visible only via the service-role
-- admin client). RLS is enabled but with no per-tenant SELECT policy —
-- the platform SUPER_ADMIN role bypasses RLS via the service role.
-- compliance_escalations DOES carry a tenant_id for join visibility from
-- per-tenant tools, but rows live in a single shared table.
--
-- Idempotent (IF NOT EXISTS). Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. regulator_pipeline_entries
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS regulator_pipeline_entries (
  id                       text PRIMARY KEY,
  source                   text NOT NULL,
  title                    text NOT NULL,
  summary                  text,
  url                      text,
  status                   text NOT NULL DEFAULT 'incoming',
  captured_at              timestamptz NOT NULL DEFAULT now(),
  reviewed_at              timestamptz,
  pushed_to_corpus_at      timestamptz,
  reviewed_by_user_id      text,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulator_pipeline_entries_source_chk
    CHECK (source IN ('gazette', 'nemc', 'bot', 'tra', 'tumemadini')),
  CONSTRAINT regulator_pipeline_entries_status_chk
    CHECK (status IN ('incoming', 'reviewing', 'approved', 'pushed'))
);

CREATE INDEX IF NOT EXISTS regulator_pipeline_entries_status_idx
  ON regulator_pipeline_entries(status, captured_at DESC);
CREATE INDEX IF NOT EXISTS regulator_pipeline_entries_source_idx
  ON regulator_pipeline_entries(source, captured_at DESC);
CREATE INDEX IF NOT EXISTS regulator_pipeline_entries_captured_at_idx
  ON regulator_pipeline_entries(captured_at DESC);

ALTER TABLE regulator_pipeline_entries ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. prompt_promotions
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS prompt_promotions (
  id                       text PRIMARY KEY,
  kind                     text NOT NULL DEFAULT 'prompt',
  subject                  text NOT NULL,
  prompt_name              text,
  from_version             text,
  to_version               text NOT NULL,
  promoted_by_user_id      text NOT NULL,
  promoted_at              timestamptz NOT NULL DEFAULT now(),
  reverted_at              timestamptz,
  reverted_by_user_id      text,
  revert_reason            text,
  can_revert               boolean NOT NULL DEFAULT true,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_promotions_kind_chk
    CHECK (kind IN ('prompt', 'model', 'corpus'))
);

CREATE INDEX IF NOT EXISTS prompt_promotions_promoted_at_idx
  ON prompt_promotions(promoted_at DESC);
CREATE INDEX IF NOT EXISTS prompt_promotions_kind_idx
  ON prompt_promotions(kind, promoted_at DESC);
CREATE INDEX IF NOT EXISTS prompt_promotions_subject_idx
  ON prompt_promotions(subject, promoted_at DESC);

ALTER TABLE prompt_promotions ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 3. compliance_escalations
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS compliance_escalations (
  id                       text PRIMARY KEY,
  tenant_id                text REFERENCES tenants(id) ON DELETE CASCADE,
  agent_source             text NOT NULL,
  severity                 text NOT NULL DEFAULT 'medium',
  summary                  text NOT NULL,
  evidence_ids             jsonb NOT NULL DEFAULT '[]'::jsonb,
  escalated_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at              timestamptz,
  resolved_by_user_id      text,
  resolution_decision      text,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_escalations_severity_chk
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT compliance_escalations_decision_chk
    CHECK (resolution_decision IS NULL OR resolution_decision IN ('approve', 'reject', 'defer'))
);

CREATE INDEX IF NOT EXISTS compliance_escalations_tenant_idx
  ON compliance_escalations(tenant_id, escalated_at DESC);
CREATE INDEX IF NOT EXISTS compliance_escalations_open_idx
  ON compliance_escalations(escalated_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS compliance_escalations_severity_idx
  ON compliance_escalations(severity, escalated_at DESC);

ALTER TABLE compliance_escalations ENABLE ROW LEVEL SECURITY;

COMMIT;
