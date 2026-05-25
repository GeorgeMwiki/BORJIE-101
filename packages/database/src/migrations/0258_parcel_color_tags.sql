-- =============================================================================
-- 0258: parcel_color_tags — re-usable colour palette + tag library per tenant.
--
-- Each tenant defines a palette of meaningful colour/label combinations
-- (e.g. red = "in negotiation", blue = "available_for_lease", grey =
-- "disputed"). Parcels reference these by slug via `parcels.label` or
-- application-side joins; this table is the canonical palette source.
--
-- Slug is UNIQUE per tenant. Seed/migrate via application bootstrap; no
-- platform-wide defaults are seeded here — tenants get a blank palette
-- and pick their own.
-- =============================================================================

CREATE TABLE IF NOT EXISTS parcel_color_tags (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** Stable per-tenant slug like 'in_negotiation', 'disputed'. */
  slug                    TEXT NOT NULL,
  display_name            TEXT NOT NULL,
  color_hex               TEXT NOT NULL,
  /** Free-text explanation of what this tag means in this tenant's workflow. */
  meaning                 TEXT,
  /** Optional icon identifier (e.g. lucide-react name). */
  icon                    TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT parcel_color_tag_slug_unique UNIQUE (tenant_id, slug),
  CONSTRAINT parcel_color_tag_hex_chk CHECK (
    color_hex ~ '^#[0-9A-Fa-f]{6}$'
  )
);

COMMENT ON TABLE parcel_color_tags IS
  'Piece N: per-tenant palette of meaningful colour/label combinations for parcel map rendering.';

COMMENT ON COLUMN parcel_color_tags.slug IS
  'Stable per-tenant slug. UNIQUE(tenant_id, slug). Used as the join key from parcels.';

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — tenant isolation pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'parcel_color_tags'
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
