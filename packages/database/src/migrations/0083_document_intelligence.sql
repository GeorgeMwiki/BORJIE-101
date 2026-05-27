-- =============================================================================
-- Migration 0083 — Document Intelligence (Wave DOC-INTEL)
--
-- Companion to:
--   - services/api-gateway/src/routes/mining/document-intelligence.hono.ts
--   - apps/{owner-web,admin-web,workforce-mobile,buyer-mobile}/src/documents/
--   - Docs/build/BOJI_BUILD_PLAN.md §Phase 3 (Document Intelligence)
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- "Documents as alive entities." Users upload contracts / RFPs / letters
-- via the chat paperclip OR a dedicated Documents section. Files flow
-- through corpus ingestion and the brain converses with them.
--
-- Three additions:
--
--   1) ALTER TABLE document_uploads — add columns for the intelligence
--      pipeline:
--        * kind            text — contract|rfp|letter|report|other
--                                  (filled by the auto-classifier; default
--                                  'other' so existing rows continue to
--                                  load).
--        * ingestion_status text — queued|processing|ready|failed (drives
--                                   the UI badge).
--        * ingestion_error  text — last failure reason (nullable).
--        * ingested_at      timestamptz — set when status flips to ready.
--      Idempotent via DO blocks.
--
--   2) document_intelligence_sessions — pairs a user with the set of
--      uploaded documents they are exploring. One row per session.
--      Sessions can carry an initial prompt and a title. tenant-scoped
--      via RLS GUC. Indexed on (tenant_id, user_id, created_at DESC) for
--      the documents-tab inbox query.
--
--   3) document_corpus_links — joins a document_uploads row to its
--      intelligence_corpus_chunks rows so a session can scope retrieval
--      to "this document only" (vs the global corpus). One row per
--      (document_id, chunk_id) pair. tenant-scoped + RLS-forced.
--
-- Tenant-scoped via the canonical `current_setting('app.tenant_id', true)`
-- GUC RLS pattern. RLS is FORCE-enabled per the Borjie hard rule
-- (`CLAUDE.md`) so the policy applies to table owners too.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) document_uploads — add intelligence pipeline columns
-- -----------------------------------------------------------------------------

ALTER TABLE document_uploads
  ADD COLUMN IF NOT EXISTS kind              text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS ingestion_status  text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS ingestion_error   text,
  ADD COLUMN IF NOT EXISTS ingested_at       timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_uploads_kind_chk'
  ) THEN
    ALTER TABLE document_uploads
      ADD CONSTRAINT document_uploads_kind_chk
      CHECK (kind IN ('contract', 'rfp', 'letter', 'report', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_uploads_ingestion_status_chk'
  ) THEN
    ALTER TABLE document_uploads
      ADD CONSTRAINT document_uploads_ingestion_status_chk
      CHECK (ingestion_status IN ('queued', 'processing', 'ready', 'failed'));
  END IF;
END $$;

-- Index for the documents-tab inbox query: per-tenant, newest first.
CREATE INDEX IF NOT EXISTS idx_document_uploads_tenant_created
  ON document_uploads (tenant_id, created_at DESC);

-- Index for the ingestion worker poll: queued|processing rows only.
CREATE INDEX IF NOT EXISTS idx_document_uploads_ingestion_status
  ON document_uploads (tenant_id, ingestion_status)
  WHERE ingestion_status IN ('queued', 'processing');

-- -----------------------------------------------------------------------------
-- 2) document_intelligence_sessions — user-bound chat sessions with one or
--    more uploaded documents.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS document_intelligence_sessions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text        NOT NULL,
  /** User who opened the session. */
  user_id           text        NOT NULL,
  /** Optional human-friendly title; defaults to the first document name. */
  title             text,
  /** Array of document_uploads.id (text) that this session is scoped to. */
  document_ids      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  /** Optional first-turn prompt the user typed when opening the session. */
  initial_prompt    text,
  /** active|archived. */
  status            text        NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_message_at   timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dis_status_chk'
  ) THEN
    ALTER TABLE document_intelligence_sessions
      ADD CONSTRAINT dis_status_chk
      CHECK (status IN ('active', 'archived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dis_document_ids_nonempty_chk'
  ) THEN
    ALTER TABLE document_intelligence_sessions
      ADD CONSTRAINT dis_document_ids_nonempty_chk
      CHECK (jsonb_array_length(document_ids) > 0);
  END IF;
END $$;

-- Hot path: list a user's sessions newest first.
CREATE INDEX IF NOT EXISTS idx_dis_tenant_user_created
  ON document_intelligence_sessions (tenant_id, user_id, created_at DESC);

-- Tenant-wide latest activity (admin surface).
CREATE INDEX IF NOT EXISTS idx_dis_tenant_last_message
  ON document_intelligence_sessions (tenant_id, last_message_at DESC NULLS LAST);

ALTER TABLE document_intelligence_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_intelligence_sessions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'document_intelligence_sessions'
       AND policyname = 'dis_tenant_isolation'
  ) THEN
    CREATE POLICY dis_tenant_isolation
      ON document_intelligence_sessions
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3) document_corpus_links — joins a document_uploads row to its chunks in
--    intelligence_corpus_chunks so retrieval can be scoped to "this doc".
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS document_corpus_links (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  /** Source doc id (FK-soft to document_uploads.id; text PK there). */
  document_id     text        NOT NULL,
  /** Target chunk id (FK-soft to intelligence_corpus_chunks.id). */
  chunk_id        text        NOT NULL,
  /** Zero-based chunk order within the document. */
  chunk_index     integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dcl_document_chunk_uniq'
  ) THEN
    ALTER TABLE document_corpus_links
      ADD CONSTRAINT dcl_document_chunk_uniq
      UNIQUE (document_id, chunk_id);
  END IF;
END $$;

-- Per-document chunk lookup (scope retrieval to this doc).
CREATE INDEX IF NOT EXISTS idx_dcl_tenant_document
  ON document_corpus_links (tenant_id, document_id, chunk_index);

-- Reverse lookup (which doc owns this chunk).
CREATE INDEX IF NOT EXISTS idx_dcl_tenant_chunk
  ON document_corpus_links (tenant_id, chunk_id);

ALTER TABLE document_corpus_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_corpus_links FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'document_corpus_links'
       AND policyname = 'dcl_tenant_isolation'
  ) THEN
    CREATE POLICY dcl_tenant_isolation
      ON document_corpus_links
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
