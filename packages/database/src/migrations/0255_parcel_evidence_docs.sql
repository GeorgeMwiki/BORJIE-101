-- =============================================================================
-- 0255: parcel_evidence_docs — title deeds, leases, photos linked to a parcel.
--
-- An evidence record attaches a document to a parcel and stamps a trust
-- score. Documents themselves live in the `documents` table (Piece K) —
-- `document_id` is a SOFT pointer so this migration works even if Piece K
-- hasn't landed yet.
--
-- Evidence kinds:
--   * `title_deed`        — formal land registry title
--   * `lease_agreement`   — signed lease contract
--   * `survey_diagram`    — surveyor's dimensioned diagram
--   * `photo`             — on-site photograph
--   * `video`             — on-site video
--   * `court_ruling`      — court order or judgement
--
-- `trust_score` is a 0.00..1.00 confidence number. AI extraction (Piece K
-- OCR + LLM) emits an initial score; human verification can override it
-- via `verified_by_user_id` / `verified_at`.
--
-- `public_visible` is the gate that controls whether the evidence shows
-- up on the marketplace public listing view (0256 + 0260's view). Defaults
-- FALSE — owner explicitly opts in to public visibility.
-- =============================================================================

CREATE TABLE IF NOT EXISTS parcel_evidence_docs (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parcel_id               TEXT NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  /** SOFT pointer to documents.id (Piece K). FK wired when Piece K lands. */
  document_id             TEXT,
  evidence_kind           TEXT NOT NULL,
  /** 0.00..1.00 confidence. Combine AI extraction + manual verification. */
  trust_score             NUMERIC(3, 2),
  verified_by_user_id     TEXT,
  verified_at             TIMESTAMPTZ,
  /** Supabase storage path or S3 key (denormalised for quick access). */
  storage_path            TEXT,
  public_visible          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT parcel_evidence_kind_chk CHECK (
    evidence_kind IN (
      'title_deed', 'lease_agreement', 'survey_diagram',
      'photo', 'video', 'court_ruling'
    )
  ),
  CONSTRAINT parcel_evidence_trust_score_chk CHECK (
    trust_score IS NULL OR (trust_score >= 0.00 AND trust_score <= 1.00)
  )
);

COMMENT ON TABLE parcel_evidence_docs IS
  'Piece N: title deeds, leases, surveys, photos, videos, court rulings linked to a parcel.';

COMMENT ON COLUMN parcel_evidence_docs.document_id IS
  'SOFT pointer to documents.id (Piece K). FK wired up when Piece K lands.';

COMMENT ON COLUMN parcel_evidence_docs.trust_score IS
  '0.00..1.00 confidence. AI-extracted initial value; human verification can override.';

COMMENT ON COLUMN parcel_evidence_docs.public_visible IS
  'If TRUE, evidence may surface on the marketplace public listing view. Default FALSE — explicit opt-in.';

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — tenant isolation pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'parcel_evidence_docs'
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
