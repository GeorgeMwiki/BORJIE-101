-- =============================================================================
-- 0213: document_entities — Piece K document-analysis pipeline (stage 3).
--
-- Entity-resolution layer. Bridges extracted facts (document_extractions)
-- to canonical entity rows. The canonical entity table is `core_entity`
-- (lessees, properties, stations, vendors, ...) — when that table lands,
-- `resolved_entity_id` will FK into it. Until then it is stored as a
-- soft TEXT pointer to avoid blocking on a sibling migration.
--
-- This migration:
--   1. Creates `document_entities` (tenant-scoped, FK to extraction).
--   2. Indexes for hot-path queries (by document, by HITL status).
--   3. Gold-standard RLS pattern.
--
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS document_entities (
  id                       TEXT PRIMARY KEY,
  document_id              TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  extraction_id            TEXT NOT NULL REFERENCES document_extractions(id) ON DELETE CASCADE,
  /** Soft pointer until core_entity lands; will be FK'd in a future
      migration. NULL = no match found (or HITL pending). */
  resolved_entity_id       TEXT,
  resolution_confidence    NUMERIC(5,4) NOT NULL,
  /** exact_match | fuzzy | embedding | hitl_confirmed */
  resolution_method        TEXT NOT NULL,
  /** pending | approved | rejected — NULL if no HITL needed (auto-resolved). */
  resolution_hitl_status   TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_entities_doc_idx
  ON document_entities (document_id);

CREATE INDEX IF NOT EXISTS document_entities_extraction_idx
  ON document_entities (extraction_id);

CREATE INDEX IF NOT EXISTS document_entities_resolved_idx
  ON document_entities (tenant_id, resolved_entity_id)
  WHERE resolved_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS document_entities_hitl_queue_idx
  ON document_entities (tenant_id, resolution_hitl_status)
  WHERE resolution_hitl_status = 'pending';

COMMENT ON TABLE document_entities IS
  'Piece K stage 3 — entity resolution. Links extracted facts to canonical entities (core_entity, when that table lands).';

COMMENT ON COLUMN document_entities.resolved_entity_id IS
  'Soft pointer to canonical entity row. A foreign key will be added when the core_entity table is created.';

COMMENT ON COLUMN document_entities.resolution_method IS
  'exact_match | fuzzy | embedding | hitl_confirmed';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'document_entities'
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'document_entities_resolution_confidence_chk'
      AND table_name = 'document_entities'
  ) THEN
    ALTER TABLE document_entities
      ADD CONSTRAINT document_entities_resolution_confidence_chk
      CHECK (resolution_confidence >= 0 AND resolution_confidence <= 1) NOT VALID;
    ALTER TABLE document_entities
      VALIDATE CONSTRAINT document_entities_resolution_confidence_chk;
  END IF;
END
$$;
