-- =============================================================================
-- 0256: parcel_marketplace_listings — publish parcels for sale / lease.
--
-- A listing surfaces a parcel (or an entire land_area) on the BORJIE
-- marketplace. Cross-tenant browsing is gated by:
--   1. `listing_status = 'active'`
--   2. `listing_visible_publicly = TRUE`
--   3. The dedicated read-only view `public_parcel_listings_v` (0260)
--      that pre-filters by 1 + 2. NEVER expose this table directly to
--      cross-tenant reads — RLS isolates by `tenant_id` and the view is
--      the ONLY path that bypasses that isolation.
--
-- If `listing_visible_to_tenant_ids` is non-empty, the listing is
-- restricted to those tenants (semi-private B2B marketplace channel).
-- Empty array + `listing_visible_publicly = TRUE` → fully public.
-- Empty array + `listing_visible_publicly = FALSE` → owner-only (draft
-- or paused).
--
-- Pricing: `asking_price_minor_units` is in tenant currency MINOR UNITS
-- (cents). Multi-currency support per CLAUDE.md hard rule — always
-- render with `formatCurrency(amount, currencyCode)`, never hard-code.
-- `currency_code` is the explicit ISO 4217 code (e.g. 'TZS', 'KES').
--
-- Listing kinds:
--   * `sale`                   — outright sale
--   * `lease`                  — long-term lease
--   * `shared_use`             — co-use / occupancy
--   * `investment_partnership` — equity / JV
-- =============================================================================

CREATE TABLE IF NOT EXISTS parcel_marketplace_listings (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  listed_by_user_id           TEXT NOT NULL REFERENCES users(id),
  /** Either parcel_id or land_area_id should be set; both can be NULL transitorily for drafts. */
  parcel_id                   TEXT REFERENCES parcels(id) ON DELETE CASCADE,
  land_area_id                TEXT REFERENCES land_areas(id) ON DELETE CASCADE,
  listing_kind                TEXT NOT NULL,
  title                       TEXT NOT NULL,
  description                 TEXT NOT NULL,
  /** Minor units (cents). Multi-currency — always pair with currency_code. */
  asking_price_minor_units    BIGINT,
  /** ISO 4217 code: 'TZS', 'KES', 'NGN', etc. */
  currency_code               TEXT,
  listing_status              TEXT NOT NULL DEFAULT 'draft',
  listing_visible_publicly    BOOLEAN NOT NULL DEFAULT TRUE,
  /** Empty array + publicly = TRUE → fully public. Non-empty → restricted. */
  listing_visible_to_tenant_ids TEXT[] NOT NULL DEFAULT '{}',
  /** Free-shape features: water_access, electricity, road_access, fencing, ... */
  features_jsonb              JSONB NOT NULL DEFAULT '{}'::jsonb,
  image_urls                  TEXT[] NOT NULL DEFAULT '{}',
  contact_method              TEXT NOT NULL DEFAULT 'in_app',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at                  TIMESTAMPTZ,
  sold_at                     TIMESTAMPTZ,
  sold_to_user_id             TEXT REFERENCES users(id),
  CONSTRAINT parcel_listing_kind_chk CHECK (
    listing_kind IN ('sale', 'lease', 'shared_use', 'investment_partnership')
  ),
  CONSTRAINT parcel_listing_status_chk CHECK (
    listing_status IN ('draft', 'active', 'paused', 'sold', 'expired')
  ),
  CONSTRAINT parcel_listing_contact_method_chk CHECK (
    contact_method IN ('in_app', 'whatsapp', 'phone', 'email')
  ),
  CONSTRAINT parcel_listing_currency_chk CHECK (
    currency_code IS NULL OR LENGTH(currency_code) = 3
  ),
  CONSTRAINT parcel_listing_subject_chk CHECK (
    -- At least one of parcel_id or land_area_id should be set once active.
    listing_status = 'draft' OR parcel_id IS NOT NULL OR land_area_id IS NOT NULL
  )
);

COMMENT ON TABLE parcel_marketplace_listings IS
  'Piece N: marketplace listings for parcels / land areas. Cross-tenant reads ONLY via public_parcel_listings_v (0260).';

COMMENT ON COLUMN parcel_marketplace_listings.asking_price_minor_units IS
  'Minor units (cents). Multi-currency — pair with currency_code. NEVER hard-code currency in business logic.';

COMMENT ON COLUMN parcel_marketplace_listings.listing_visible_to_tenant_ids IS
  'Empty + listing_visible_publicly = TRUE → fully public. Non-empty → restricted whitelist.';

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — tenant isolation pattern (cross-tenant reads go via the view in 0260).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'parcel_marketplace_listings'
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
