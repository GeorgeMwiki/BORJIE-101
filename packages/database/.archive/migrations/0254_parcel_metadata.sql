-- =============================================================================
-- 0254: parcel_metadata — typed extensible KV metadata per parcel.
--
-- Open-schema annotations on a parcel without forcing column churn. The
-- application enforces `key` whitelisting per `value_kind`; this table is
-- the storage layer.
--
-- Conventions:
--   * `key` is a stable slug ('soil_type', 'water_access', 'electricity',
--     'fencing', 'gate_count', 'gradient', 'flood_risk', ...). Lowercased
--     snake_case.
--   * `value_kind` tells callers how to interpret `value_jsonb`:
--       'text'    → {"value": "loam"}
--       'number'  → {"value": 42.5}
--       'boolean' → {"value": true}
--       'date'    → {"value": "2025-12-01"}
--       'enum'    → {"value": "high", "options": ["low","medium","high"]}
--       'jsonb'   → {... arbitrary object ...}
--   * One key per parcel — UNIQUE(parcel_id, key). Update in place.
--
-- This is intentionally a typed EAV table; for fast filtered queries on a
-- specific key, add a partial expression index outside this migration.
-- =============================================================================

CREATE TABLE IF NOT EXISTS parcel_metadata (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parcel_id               TEXT NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  /** Stable slug; app whitelist. */
  key                     TEXT NOT NULL,
  /** How to interpret value_jsonb. */
  value_kind              TEXT NOT NULL,
  value_jsonb             JSONB NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id      TEXT,
  CONSTRAINT parcel_metadata_value_kind_chk CHECK (
    value_kind IN ('text', 'number', 'boolean', 'date', 'enum', 'jsonb')
  ),
  CONSTRAINT parcel_metadata_unique_key UNIQUE (parcel_id, key)
);

COMMENT ON TABLE parcel_metadata IS
  'Piece N: typed EAV metadata per parcel. One key per parcel; update in place.';

COMMENT ON COLUMN parcel_metadata.value_kind IS
  'Type discriminator: text | number | boolean | date | enum | jsonb. Callers MUST validate value_jsonb shape against this.';

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — tenant isolation pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'parcel_metadata'
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
