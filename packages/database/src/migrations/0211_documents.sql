-- =============================================================================
-- 0211: documents — Piece K document-analysis pipeline (stage 1).
--
-- Top-level document record. Every file uploaded into Borjie (lease
-- application, payment receipt, NIDA scan, condition survey, complaint
-- letter, ...) lands here first. Subsequent pipeline stages
-- (extraction, entity resolution, routing) reference this row.
--
-- This migration:
--   1. Creates the `documents` table — tenant-scoped, with the canonical
--      provenance + processing-state machinery.
--   2. Adds indexes for hot-path queries (tenant + processing_state,
--      tenant + created_at DESC, sha256 dedupe).
--   3. Installs the GOLD-STANDARD RLS pattern matching 0182 / 0183 /
--      0184 / 0185:
--        * ENABLE + FORCE ROW LEVEL SECURITY
--        * tenant_isolation_select policy (USING)
--        * tenant_isolation_modify policy (FOR ALL, USING + WITH CHECK)
--        * REVOKE ALL FROM anon (defence-in-depth)
--
-- Idempotent: every operation gated on object existence.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the documents table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  uploaded_by_user_id  TEXT REFERENCES users(id),
  filename             TEXT NOT NULL,
  mime_type            TEXT NOT NULL,
  size_bytes           BIGINT NOT NULL,
  storage_path         TEXT NOT NULL,
  sha256               TEXT NOT NULL,
  page_count           INTEGER,
  ocr_text             TEXT,
  ocr_language         TEXT,
  /** pending | ocr_done | parsed | extracted | routed | done | error */
  processing_state     TEXT NOT NULL DEFAULT 'pending',
  processing_error     TEXT,
  /** web_upload | whatsapp_attach | email | agent */
  source_channel       TEXT,
  related_thread_id    TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant-scoped uniqueness on sha256: dedupe within a tenant, but the same
-- file uploaded by two different tenants must remain isolated (RLS-safe).
CREATE UNIQUE INDEX IF NOT EXISTS documents_tenant_sha256_uniq
  ON documents (tenant_id, sha256);

CREATE INDEX IF NOT EXISTS documents_tenant_state_idx
  ON documents (tenant_id, processing_state);

CREATE INDEX IF NOT EXISTS documents_tenant_created_idx
  ON documents (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS documents_thread_idx
  ON documents (related_thread_id)
  WHERE related_thread_id IS NOT NULL;

COMMENT ON TABLE documents IS
  'Piece K stage 1 — top-level document record. Every uploaded file lands here before pipeline stages (extraction/resolution/routing) reference it.';

COMMENT ON COLUMN documents.processing_state IS
  'pending | ocr_done | parsed | extracted | routed | done | error';

COMMENT ON COLUMN documents.ocr_language IS
  'en | sw | mixed | <other>. Bilingual support: Swahili + English via Tesseract traineddata.';

COMMENT ON COLUMN documents.sha256 IS
  'Content hash; unique per tenant for dedupe. RLS keeps tenants isolated.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'documents'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- Operator note: writes from the api-gateway path are authenticated and
-- carry an `app.current_tenant_id` GUC bound by the tenant-resolution
-- middleware. Pipeline workers (orchestrator) run as service-role and
-- bypass RLS — they must therefore set tenant_id on every write.
