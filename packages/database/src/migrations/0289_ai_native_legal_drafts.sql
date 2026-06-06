-- =============================================================================
-- Migration 0289 — legal_drafts (Agent PhL — legal-drafter durable store).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The AI-native legal-drafter capability (`@borjie/ai-copilot/ai-native`
-- namespace `LegalDrafter`) composes a REAL first-draft mining-contract
-- document (licence-suspension notice, off-take addendum, demand letter,
-- royalty-increase notice, ...) via an Anthropic LLM call grounded in the
-- jurisdiction's statutory clause/notice requirements from
-- `@borjie/compliance-plugins`. EVERY draft is queued for HUMAN review by
-- default; the only path to auto-send is an explicit tenant autonomy opt-in for
-- that kind — subject to the non-negotiable compliance invariant that a
-- licence-suspension notice is NEVER auto-sendable regardless of policy.
--
-- Until now the draft persisted ONLY to an in-process per-tenant map
-- (`services/api-gateway/src/composition/ai-native/in-memory-repos.ts`) because
-- the durable table lived only in the archived BossNyumba tree
-- (`packages/database/.archive/migrations/0109`, which used the real-estate
-- `document_kind` enum + an eviction-notice invariant). This migration stands up
-- the real MINING table so a draft survives a restart and is shared across
-- replicas. The shape mirrors the `LegalDraftRow` port exactly
-- (legal-drafter/types.ts), retargeted to the mining document kinds.
--
-- COMPLIANCE INVARIANT (mirrors FORBIDDEN_AUTO_SEND in legal-drafter/types.ts):
-- a `licence_suspension_notice` MUST always carry needs_human_review = TRUE.
-- Enforced both in code AND here via the
-- `legal_drafts_suspension_must_review` CHECK constraint — the DB refuses to
-- store a suspension notice that skips human review.
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors mig 0285 / 0135):
--   tenant_id is TEXT; FORCE ROW LEVEL SECURITY + a tenant policy on the
--   canonical `app.current_tenant_id` GUC. Bare compare (no cast) because
--   tenant_id is already TEXT. NEVER the legacy app.tenant_id.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule): nothing here is a money column —
-- any monetary fact the draft cites lives inside the free-form `context` jsonb
-- as the LLM was handed it (minor-units + currency), never a typed money column
-- and never a currency literal.
--
-- ID DISCIPLINE: `id` is TEXT (the PhL `generateId` helper), matching the row
-- port's `id: string` — NOT a uuid default.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule). Every object uses CREATE
-- TABLE IF NOT EXISTS / guarded DO-blocks / CREATE INDEX IF NOT EXISTS, and a
-- pg_roles guard around the anon REVOKE. On a fully-migrated DB this is a pure
-- no-op. References only pre-existing infra (`tenants`, pgcrypto).
--
-- Companion files:
--   * packages/database/src/schemas/ai-native-legal-drafts.schema.ts
--   * services/api-gateway/src/composition/ai-native/drizzle-repos.ts
--   * services/api-gateway/src/composition/ai-native-wiring.ts
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- legal_drafts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS legal_drafts (
  id                    text        PRIMARY KEY,
  tenant_id             text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_kind         text        NOT NULL,
  -- ISO-3166-1 alpha-2 jurisdiction driving the statutory clause set.
  country_code          text        NOT NULL,
  -- Subdivision / locality metadata (e.g. region) the law dispatch resolved.
  jurisdiction_metadata jsonb       NOT NULL DEFAULT '{}'::jsonb,
  subject_customer_id   text,
  subject_offtake_id    text,
  subject_site_id       text,
  subject_pit_id        text,
  -- ISO-639-1/-2; echoes the tenant's language (never hardcoded en/sw).
  language_code         text,
  draft_title           text        NOT NULL,
  draft_body            text        NOT NULL,
  -- Statutory clauses required for this kind in this jurisdiction.
  required_clauses      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Statute refs / URLs the draft relied on.
  legal_citations       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Ambiguity / missing-facts flags surfaced for the human reviewer.
  review_flags          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  needs_human_review    boolean     NOT NULL DEFAULT true,
  -- Always 'draft' from the AI-native drafter; the review chain owns the rest.
  status                text        NOT NULL DEFAULT 'draft',
  autonomy_decision     text        NOT NULL,
  model_version         text        NOT NULL,
  prompt_hash           text        NOT NULL,
  confidence            double precision NOT NULL,
  -- Facts the LLM was handed (minor-units + currency live here, never a column).
  context               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- PhL Citation[] (kind/ref/note) the draft surfaced.
  citations             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_by            text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'legal_drafts_document_kind_chk'
  ) THEN
    ALTER TABLE legal_drafts
      ADD CONSTRAINT legal_drafts_document_kind_chk
      CHECK (document_kind IN (
        'notice_to_cease',
        'offtake_addendum',
        'demand_letter',
        'licence_suspension_notice',
        'renewal_offer',
        'royalty_increase_notice',
        'cure_or_cease',
        'offboarding_statement',
        'other'
      ));
  END IF;

  -- Compliance invariant: a licence-suspension notice MUST require review.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'legal_drafts_suspension_must_review'
  ) THEN
    ALTER TABLE legal_drafts
      ADD CONSTRAINT legal_drafts_suspension_must_review
      CHECK (
        document_kind <> 'licence_suspension_notice'
        OR needs_human_review = TRUE
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'legal_drafts_status_chk'
  ) THEN
    ALTER TABLE legal_drafts
      ADD CONSTRAINT legal_drafts_status_chk
      CHECK (status IN (
        'draft', 'reviewed', 'approved', 'rejected', 'sent', 'superseded'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'legal_drafts_autonomy_decision_chk'
  ) THEN
    ALTER TABLE legal_drafts
      ADD CONSTRAINT legal_drafts_autonomy_decision_chk
      CHECK (autonomy_decision IN (
        'queued_for_review', 'auto_send_allowed', 'auto_send_forbidden'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'legal_drafts_confidence_chk'
  ) THEN
    ALTER TABLE legal_drafts
      ADD CONSTRAINT legal_drafts_confidence_chk
      CHECK (confidence BETWEEN 0 AND 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_legal_drafts_tenant_created
  ON legal_drafts (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_legal_drafts_tenant_kind_created
  ON legal_drafts (tenant_id, document_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_legal_drafts_review_queue
  ON legal_drafts (tenant_id, needs_human_review, status)
  WHERE needs_human_review = TRUE AND status = 'draft';

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC.
-- -----------------------------------------------------------------------------

ALTER TABLE legal_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_drafts FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'legal_drafts'
       AND policyname = 'legal_drafts_tenant_isolation'
  ) THEN
    CREATE POLICY legal_drafts_tenant_isolation
      ON legal_drafts
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.legal_drafts FROM anon;';
  END IF;
END $$;

COMMIT;
