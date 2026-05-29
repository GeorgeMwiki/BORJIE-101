-- =============================================================================
-- Migration 0136 — inspection_narratives
--
-- Closes the inspection narrative chain (C-C from issue #194).
-- One row per inspection that has had a narrative drafted by Mr.
-- Mwikila (LLM), reviewed by the manager, signed by the owner, and
-- submitted to the regulator (NEMC for environmental, OSHA-equivalent
-- for safety).
--
-- Companion to:
--   - services/api-gateway/src/routes/compliance/inspections.hono.ts
--   - services/api-gateway/src/services/inspection-narrative/generator.ts
--   - packages/database/src/schemas/inspection-narratives.schema.ts
--   - apps/workforce-mobile/app/(manager)/inspection/[id]/narrative.tsx
--
-- The narrative is Markdown (sw + en) plus a structured frontmatter
-- block. C2PA-signed photo references are stapled to the narrative
-- via the inspection_id back-reference.
--
-- State machine:
--   draft         — LLM generated; manager has not approved
--   manager_ok    — manager approved; awaiting owner sig
--   owner_signed  — owner signed; ready to submit
--   submitted     — sent to regulator (PDF + photos)
--   delivered     — regulator acknowledged
--   superseded    — re-run; a newer narrative exists
--
-- Tenant scope: tenant_id::text = current_setting('app.current_tenant_id', true)
-- RLS FORCE-enabled per CLAUDE.md hard rule. Forward-only.
-- IMMUTABLE: do not edit after merge; append a new file.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS inspection_narratives (
  id                  text         PRIMARY KEY,
  tenant_id           text         NOT NULL,
  /** FK to pre_shift_inspections.id (or any inspection table). */
  inspection_id       text         NOT NULL,
  /** environmental | safety | financial | other. */
  inspection_kind     text         NOT NULL DEFAULT 'safety',
  /** draft | manager_ok | owner_signed | submitted | delivered | superseded. */
  status              text         NOT NULL DEFAULT 'draft',
  /** Swahili-first Markdown narrative — primary output. */
  draft_md_sw         text         NOT NULL,
  /** English Markdown — generated alongside. */
  draft_md_en         text         NOT NULL,
  /** anthropic | openai | google | local — provenance of generation. */
  llm_provider        text,
  /** Model id (e.g. claude-opus-4-7, gpt-4-turbo). */
  llm_model           text,
  /** Prompt template version — for regression-test reproducibility. */
  prompt_version      text         NOT NULL DEFAULT 'v1',
  /** Token + USD cost of the generation. */
  cost_usd            numeric(12, 4),
  generated_at        timestamptz  NOT NULL DEFAULT now(),
  manager_ok_at       timestamptz,
  manager_ok_by       text,
  owner_signed_at     timestamptz,
  owner_signed_by     text,
  /** SHA-256 of the canonical PDF the owner signed. */
  owner_sig_sha256    text,
  regulator_sent_at   timestamptz,
  /** pccb | nemc | tmaa | osha | none. */
  regulator           text,
  /** Reference returned by the regulator on delivery. */
  regulator_ref       text,
  /** ai_audit_chain.sequenceNumber — anchored on first submit. */
  audit_chain_seq     bigint,
  /** Free-form notes captured by the manager during review. */
  manager_notes       text,
  superseded_by_id    text,
  created_by          text,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'inspection_narratives_kind_chk'
  ) THEN
    ALTER TABLE inspection_narratives
      ADD CONSTRAINT inspection_narratives_kind_chk
      CHECK (inspection_kind IN (
        'environmental', 'safety', 'financial', 'other'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'inspection_narratives_status_chk'
  ) THEN
    ALTER TABLE inspection_narratives
      ADD CONSTRAINT inspection_narratives_status_chk
      CHECK (status IN (
        'draft', 'manager_ok', 'owner_signed', 'submitted',
        'delivered', 'superseded'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'inspection_narratives_regulator_chk'
  ) THEN
    ALTER TABLE inspection_narratives
      ADD CONSTRAINT inspection_narratives_regulator_chk
      CHECK (regulator IS NULL OR regulator IN (
        'pccb', 'nemc', 'tmaa', 'osha', 'none'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS inspection_narratives_tenant_idx
  ON inspection_narratives (tenant_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS inspection_narratives_inspection_idx
  ON inspection_narratives (tenant_id, inspection_id);

CREATE INDEX IF NOT EXISTS inspection_narratives_status_idx
  ON inspection_narratives (tenant_id, status);

ALTER TABLE inspection_narratives ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_narratives FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'inspection_narratives'
       AND policyname = 'inspection_narratives_tenant_isolation'
  ) THEN
    CREATE POLICY inspection_narratives_tenant_isolation
      ON inspection_narratives
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
