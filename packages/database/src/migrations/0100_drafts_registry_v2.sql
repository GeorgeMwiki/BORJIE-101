-- =============================================================================
-- Migration 0100 — Drafts Registry v2 (Universal Drafter)
--
-- Wave UNIVERSAL-DOC-DRAFTER. Extends the v1 drafts registry (migration
-- 0084) to support:
--   * free-form drafts (no template required); persisted with
--     `inferred_kind` and the originating natural-language `intent`.
--   * per-revision history table so reverts and side-by-side diffs are
--     possible (the v1 self-join via `parent_draft_id` was workable but
--     made point-in-time reads quadratic).
--   * per-revision citation track-record (which corpus chunks and
--     owner-uploaded documents informed each section).
--
-- New columns on `document_drafts`:
--   intent                    text        — owner's natural language ask
--   inferred_kind             text        — brain's inferred document kind
--   current_revision_no       integer     — most-recent revision in the
--                                            child `draft_revisions` table
--   classification            text        — Confidential|Internal|Public
--   rendered_blob_urls        jsonb       — cached PDF/DOCX/PPTX urls by
--                                            format
--
-- New tables:
--   draft_revisions          — every save spawns a new revision row.
--   draft_citations          — sources the brain pulled per revision.
--
-- Tenant-scoping is enforced via the canonical
-- `current_setting('app.current_tenant_id', true)` GUC RLS predicate
-- (set by the api-gateway database middleware on every authenticated
-- request). RLS is FORCE-enabled per the Borjie hard rule
-- (`CLAUDE.md`) so the policy applies to table owners too.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- document_drafts — additive columns for free-form + classification
-- -----------------------------------------------------------------------------

ALTER TABLE document_drafts
  ADD COLUMN IF NOT EXISTS intent              text,
  ADD COLUMN IF NOT EXISTS inferred_kind       text,
  ADD COLUMN IF NOT EXISTS current_revision_no integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS classification      text    NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS rendered_blob_urls  jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at          timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_drafts_classification_chk'
  ) THEN
    ALTER TABLE document_drafts
      ADD CONSTRAINT document_drafts_classification_chk
      CHECK (classification IN ('public', 'internal', 'confidential'));
  END IF;

  -- Allow source_template_slug to be NULL for free-form drafts that do
  -- not originate from a template. Skip the alter if the column is
  -- already nullable (pg_catalog reports `attnotnull = false`).
  IF EXISTS (
    SELECT 1
      FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
     WHERE c.relname = 'document_drafts'
       AND a.attname = 'source_template_slug'
       AND a.attnotnull = true
  ) THEN
    ALTER TABLE document_drafts ALTER COLUMN source_template_slug DROP NOT NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- draft_revisions — every save creates a new revision row.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS draft_revisions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  draft_id          uuid        NOT NULL REFERENCES document_drafts(id) ON DELETE CASCADE,
  revision_no       integer     NOT NULL,
  content_md        text        NOT NULL,
  content_format    text        NOT NULL DEFAULT 'markdown',
  rendered_blob_url text,
  created_by        uuid        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  citations         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  audit_hash        text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'draft_revisions_format_chk'
  ) THEN
    ALTER TABLE draft_revisions
      ADD CONSTRAINT draft_revisions_format_chk
      CHECK (content_format IN ('markdown', 'html', 'plain'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'draft_revisions_revision_no_chk'
  ) THEN
    ALTER TABLE draft_revisions
      ADD CONSTRAINT draft_revisions_revision_no_chk
      CHECK (revision_no >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'draft_revisions_draft_rev_uq'
  ) THEN
    ALTER TABLE draft_revisions
      ADD CONSTRAINT draft_revisions_draft_rev_uq
      UNIQUE (draft_id, revision_no);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_draft_revisions_tenant_draft_rev
  ON draft_revisions (tenant_id, draft_id, revision_no DESC);

CREATE INDEX IF NOT EXISTS idx_draft_revisions_tenant_created
  ON draft_revisions (tenant_id, created_at DESC);

ALTER TABLE draft_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_revisions FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'draft_revisions'
       AND policyname = 'draft_revisions_tenant_isolation'
  ) THEN
    CREATE POLICY draft_revisions_tenant_isolation
      ON draft_revisions
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- draft_citations — sources the brain pulled per revision.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS draft_citations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  draft_id      uuid        NOT NULL REFERENCES document_drafts(id) ON DELETE CASCADE,
  revision_id   uuid        NOT NULL REFERENCES draft_revisions(id)  ON DELETE CASCADE,
  source_kind   text        NOT NULL,
  source_ref    text        NOT NULL,
  snippet_used  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'draft_citations_source_kind_chk'
  ) THEN
    ALTER TABLE draft_citations
      ADD CONSTRAINT draft_citations_source_kind_chk
      CHECK (source_kind IN (
        'corpus_chunk',
        'owner_doc',
        'external_benchmark',
        'peer_cohort',
        'manual'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_draft_citations_tenant_revision
  ON draft_citations (tenant_id, revision_id);

CREATE INDEX IF NOT EXISTS idx_draft_citations_tenant_draft
  ON draft_citations (tenant_id, draft_id);

ALTER TABLE draft_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_citations FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'draft_citations'
       AND policyname = 'draft_citations_tenant_isolation'
  ) THEN
    CREATE POLICY draft_citations_tenant_isolation
      ON draft_citations
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
