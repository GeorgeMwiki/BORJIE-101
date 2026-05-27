-- =============================================================================
-- Migration 0084 — Document Drafts Registry (Wave B-DocDrafter)
--
-- Companion to:
--   - services/api-gateway/src/routes/mining/draft.hono.ts
--   - services/api-gateway/src/services/document-drafter/
--   - packages/database/src/schemas/drafts.schema.ts
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- One table:
--
--   document_drafts        — persisted drafts of legal / commercial /
--                            regulatory documents that the brain
--                            assembles for the owner or manager.
--                            Markdown content, bilingual (sw / en /
--                            bilingual), tenant-scoped. Revisions
--                            are chained via parent_draft_id so the
--                            full evolution of a contract / RFP /
--                            letter is replayable. Status moves
--                            drafting -> reviewing -> finalized ->
--                            sent | archived.
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
-- document_drafts — drafted contracts / RFPs / letters / notices / memos
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS document_drafts (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  /** RLS-scoping column. */
  tenant_id            uuid        NOT NULL,
  /** User who initiated the draft (owner, manager, legal counsel). */
  created_by_user_id   uuid        NOT NULL,
  /** Draft kind: contract|rfp|rfp_response|letter|notice|memo. */
  kind                 text        NOT NULL,
  /** Lifecycle: drafting|reviewing|finalized|sent|archived. */
  status               text        NOT NULL DEFAULT 'drafting',
  /** Swahili-first title (CLAUDE.md "Swahili-first" hard rule). */
  title_sw             text        NOT NULL,
  /** Optional English mirror of the title. */
  title_en             text,
  /** Jurisdiction (TZ|KE|UG|RW|BI|...). Defaults from tenant config. */
  jurisdiction         text,
  /** Language: sw|en|bilingual. */
  language             text        NOT NULL DEFAULT 'sw',
  /** Rendered document body as Markdown. */
  content_md           text        NOT NULL,
  /** Slug of the source template used to compose the draft. */
  source_template_slug text        NOT NULL,
  /** 1-based revision counter; bumped on every /revise. */
  revision_count       integer     NOT NULL DEFAULT 1,
  /** Timestamp of the last /revise call (or first draft if unrevised). */
  last_revised_at      timestamptz NOT NULL DEFAULT now(),
  /** Self-reference: the draft id this revision was based on. */
  parent_draft_id      uuid,
  /** Hash-chained audit-trail link (audit-trail package writes on transition). */
  hash_chain_id        uuid,
  created_at           timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_drafts_kind_chk'
  ) THEN
    ALTER TABLE document_drafts
      ADD CONSTRAINT document_drafts_kind_chk
      CHECK (kind IN ('contract', 'rfp', 'rfp_response', 'letter', 'notice', 'memo'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_drafts_status_chk'
  ) THEN
    ALTER TABLE document_drafts
      ADD CONSTRAINT document_drafts_status_chk
      CHECK (status IN ('drafting', 'reviewing', 'finalized', 'sent', 'archived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_drafts_language_chk'
  ) THEN
    ALTER TABLE document_drafts
      ADD CONSTRAINT document_drafts_language_chk
      CHECK (language IN ('sw', 'en', 'bilingual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_drafts_title_nonempty_chk'
  ) THEN
    ALTER TABLE document_drafts
      ADD CONSTRAINT document_drafts_title_nonempty_chk
      CHECK (length(title_sw) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_drafts_content_nonempty_chk'
  ) THEN
    ALTER TABLE document_drafts
      ADD CONSTRAINT document_drafts_content_nonempty_chk
      CHECK (length(content_md) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_drafts_revision_count_chk'
  ) THEN
    ALTER TABLE document_drafts
      ADD CONSTRAINT document_drafts_revision_count_chk
      CHECK (revision_count >= 1);
  END IF;
END $$;

-- Hot path: list a user's drafts of a given status, newest first.
CREATE INDEX IF NOT EXISTS idx_document_drafts_tenant_creator_status_created
  ON document_drafts (tenant_id, created_by_user_id, status, created_at DESC);

-- Filter by kind (e.g. "all contracts").
CREATE INDEX IF NOT EXISTS idx_document_drafts_tenant_kind_status
  ON document_drafts (tenant_id, kind, status);

-- Revision chain traversal.
CREATE INDEX IF NOT EXISTS idx_document_drafts_parent
  ON document_drafts (parent_draft_id)
  WHERE parent_draft_id IS NOT NULL;

ALTER TABLE document_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_drafts FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'document_drafts'
       AND policyname = 'document_drafts_tenant_isolation'
  ) THEN
    CREATE POLICY document_drafts_tenant_isolation
      ON document_drafts
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
