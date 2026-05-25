-- =============================================================================
-- 0212: document_extractions — Piece K document-analysis pipeline (stage 2).
--
-- One row per extracted fact from a document. Facts span doc_type
-- classification, named entities, amounts, dates, addresses, signatures,
-- stamps, photo regions, table rows, and clauses. Each row carries page
-- + bbox so the frontend can cite back to the source PDF coordinate.
--
-- This migration:
--   1. Creates `document_extractions` (tenant-scoped, FK to documents).
--   2. Indexes for hot-path queries (by document, by kind/key, by
--      tenant+confidence for HITL queues).
--   3. Gold-standard RLS pattern (matching 0185 / 0211).
--
-- Idempotent.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the document_extractions table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document_extractions (
  id                TEXT PRIMARY KEY,
  document_id       TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** doc_type | entity | amount | date | address | signature | stamp |
      photo_region | table_row | clause */
  extraction_kind   TEXT NOT NULL,
  /** Free-form key within the kind (e.g. 'lease_start_date',
      'monthly_rent', 'lessee_name', 'plot_number', 'doc_type'). */
  key               TEXT NOT NULL,
  value_jsonb       JSONB NOT NULL,
  confidence        NUMERIC(5,4) NOT NULL,
  page              INTEGER,
  /** Bounding box on the page: { x, y, w, h } in PDF user-space units. */
  bbox_jsonb        JSONB,
  /** ocr | layout | llm_extract | rule */
  source_method     TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_extractions_doc_idx
  ON document_extractions (document_id);

CREATE INDEX IF NOT EXISTS document_extractions_tenant_kind_idx
  ON document_extractions (tenant_id, extraction_kind);

CREATE INDEX IF NOT EXISTS document_extractions_tenant_key_idx
  ON document_extractions (tenant_id, key);

-- Partial index for low-confidence HITL queue (helps the "review needed" UI).
CREATE INDEX IF NOT EXISTS document_extractions_low_confidence_idx
  ON document_extractions (tenant_id, confidence)
  WHERE confidence < 0.7;

COMMENT ON TABLE document_extractions IS
  'Piece K stage 2 — facts extracted from a document. One row per fact; carries page+bbox for citation back to source.';

COMMENT ON COLUMN document_extractions.confidence IS
  'NUMERIC(5,4) in [0.0000, 1.0000]. Below 0.7 = HITL queue.';

COMMENT ON COLUMN document_extractions.bbox_jsonb IS
  'Bounding box on the page: { x, y, w, h }. Used by renderCitation().';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'document_extractions'
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

-- Constraint guard: confidence in range. Use NOT VALID + VALIDATE so older
-- rows (if any) aren't blocked, but new writes are.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'document_extractions_confidence_chk'
      AND table_name = 'document_extractions'
  ) THEN
    ALTER TABLE document_extractions
      ADD CONSTRAINT document_extractions_confidence_chk
      CHECK (confidence >= 0 AND confidence <= 1) NOT VALID;
    ALTER TABLE document_extractions
      VALIDATE CONSTRAINT document_extractions_confidence_chk;
  END IF;
END
$$;
