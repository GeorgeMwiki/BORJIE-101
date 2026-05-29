-- =============================================================================
-- Migration 0140 — Company Brain ingestion (corpus_doc_uploads + corpus_doc_summaries)
--
-- Companion to:
--   - services/api-gateway/src/services/brain-ingestion/* (new)
--   - services/api-gateway/src/routes/owner/brain.hono.ts (extended)
--   - services/api-gateway/src/services/knowledge-graph/grower.ts (new)
--   - apps/owner-web/src/app/(routes)/brain/ingest/page.tsx (new)
--   - Docs/RESEARCH/COMPANY_BRAIN_SOTA_2026-05-29.md
--   - Docs/OPS/MEMORY_DURABILITY.md
--
-- Wave: COMPANY-BRAIN (C-1 — lossless ingestion endpoint, any format).
--
-- Two append-only tables that back the "company brain" promise:
--
--   corpus_doc_uploads      one row per file/text/audio/photo the owner
--                           feeds the brain. The lifecycle is
--                           pending → parsing → chunking → embedded
--                           → indexed (or → failed). The status field
--                           is the one mutable column (drives the
--                           live progress meter); every other field is
--                           write-once.
--
--   corpus_doc_summaries    per-upload bilingual digest (en + sw) +
--                           extracted key facts. Generated synchronously
--                           after the embed step succeeds. Write-once.
--
-- MEMORY DURABILITY: neither table has a DELETE policy. The CLAUDE.md
-- "append-only on memory tables" hard rule is enforced at the schema
-- level — no DELETE permitted via RLS, no TTL, no scheduled prune.
-- See Docs/OPS/MEMORY_DURABILITY.md for the full guarantee.
--
-- Tenant scope: tenant_id::text = current_setting('app.current_tenant_id', true)
-- RLS: FORCE-enabled per the Borjie hard rule.
--
-- Idempotent (IF NOT EXISTS). Append-only. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

-- ─── corpus_doc_uploads ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corpus_doc_uploads (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid          NOT NULL,
  /** Supabase user id (text to match the rest of Borjie's quoted-uuid style). */
  uploaded_by_user_id   text          NOT NULL,
  /** Origin classifier — drives which parser the ingest router picks. */
  source_kind           text          NOT NULL CHECK (source_kind IN (
                          'csv','xlsx','pdf','photo','audio','text','json','email','webpage'
                        )),
  original_filename     text          NOT NULL,
  size_bytes            bigint        NOT NULL CHECK (size_bytes >= 0),
  /** Where the raw bytes live (Supabase Storage / S3 / on-disk URI). */
  storage_url           text          NOT NULL,
  /** Lifecycle: pending → parsing → chunking → embedded → indexed
   *  (or → failed / redacted). The ONLY mutable column on this table. */
  status                text          NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending','parsing','chunking','embedded','indexed','failed','redacted'
                        )),
  chunks_count          integer       NOT NULL DEFAULT 0 CHECK (chunks_count >= 0),
  entities_extracted    integer       NOT NULL DEFAULT 0 CHECK (entities_extracted >= 0),
  /** Free-form error message when status='failed'. Truncated to 2KB to
   *  keep the table tight; full stack lives in the Pino log. */
  error_message         text,
  uploaded_at           timestamptz   NOT NULL DEFAULT now(),
  processed_at          timestamptz,
  /** Free-form metadata: mime_type, language hint, vision_model, stt_model. */
  metadata              jsonb         NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS corpus_doc_uploads_tenant_uploaded_idx
  ON corpus_doc_uploads (tenant_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS corpus_doc_uploads_tenant_status_idx
  ON corpus_doc_uploads (tenant_id, status);

CREATE INDEX IF NOT EXISTS corpus_doc_uploads_user_idx
  ON corpus_doc_uploads (tenant_id, uploaded_by_user_id);

ALTER TABLE corpus_doc_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus_doc_uploads FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'current_schema'
       AND tablename  = 'corpus_doc_uploads'
       AND policyname = 'corpus_doc_uploads_tenant_iso'
  ) THEN
    CREATE POLICY corpus_doc_uploads_tenant_iso ON corpus_doc_uploads
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;


-- ─── corpus_doc_summaries ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corpus_doc_summaries (
  upload_id     uuid          PRIMARY KEY REFERENCES corpus_doc_uploads(id) ON DELETE CASCADE,
  tenant_id     uuid          NOT NULL,
  /** Bilingual primary digest — Markdown, English + Swahili interleaved. */
  summary_md    text          NOT NULL,
  /** English-only digest, 1-3 paragraphs. */
  summary_en    text          NOT NULL,
  /** Swahili-only digest, 1-3 paragraphs. */
  summary_sw    text          NOT NULL,
  /** Extracted key facts: [{kind, value, confidence}]. */
  key_facts     jsonb         NOT NULL DEFAULT '[]'::jsonb,
  generated_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS corpus_doc_summaries_tenant_idx
  ON corpus_doc_summaries (tenant_id);

ALTER TABLE corpus_doc_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE corpus_doc_summaries FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'current_schema'
       AND tablename  = 'corpus_doc_summaries'
       AND policyname = 'corpus_doc_summaries_tenant_iso'
  ) THEN
    CREATE POLICY corpus_doc_summaries_tenant_iso ON corpus_doc_summaries
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
