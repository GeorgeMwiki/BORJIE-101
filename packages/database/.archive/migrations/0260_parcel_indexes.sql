-- =============================================================================
-- 0260: parcel indexes + public marketplace view.
--
-- Final piece of the Piece N migration sequence. Adds the GiST spatial
-- indexes, b-tree filter indexes, and — critically — the
-- `public_parcel_listings_v` view that is the ONLY cross-tenant read
-- path on the marketplace data.
--
-- View rationale: RLS on `parcel_marketplace_listings` isolates by
-- tenant_id. A user on tenant A browsing the marketplace MUST be able to
-- see tenant B's active public listings — that's the whole point of the
-- marketplace. We expose this via a SECURITY DEFINER-style view that
-- pre-filters to (`listing_status = 'active'` AND
-- `listing_visible_publicly = TRUE`). The view is granted SELECT to
-- authenticated; it intentionally does NOT expose owner contact details
-- beyond `contact_method` enum, and surfaces only the columns safe for
-- cross-tenant disclosure.
--
-- Writes always go through the underlying table and are RLS-isolated as
-- normal. There is no INSTEAD-OF trigger on the view.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. GiST spatial indexes — for ST_Within / ST_Intersects / bbox lookups.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS land_areas_boundary_gist_idx
  ON land_areas
  USING GIST (boundary_polygon);

CREATE INDEX IF NOT EXISTS land_areas_center_gist_idx
  ON land_areas
  USING GIST (center_point);

CREATE INDEX IF NOT EXISTS parcels_boundary_gist_idx
  ON parcels
  USING GIST (boundary_polygon);

CREATE INDEX IF NOT EXISTS parcels_center_gist_idx
  ON parcels
  USING GIST (center_point);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. b-tree filter indexes.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS parcels_tenant_status_idx
  ON parcels (tenant_id, status);

CREATE INDEX IF NOT EXISTS parcels_tenant_land_area_idx
  ON parcels (tenant_id, land_area_id);

CREATE INDEX IF NOT EXISTS land_areas_tenant_jurisdiction_idx
  ON land_areas (tenant_id, jurisdiction);

CREATE INDEX IF NOT EXISTS parcel_marketplace_listings_tenant_status_idx
  ON parcel_marketplace_listings (tenant_id, listing_status);

CREATE INDEX IF NOT EXISTS parcel_marketplace_listings_tenant_kind_idx
  ON parcel_marketplace_listings (tenant_id, listing_kind);

CREATE INDEX IF NOT EXISTS parcel_metadata_tenant_key_idx
  ON parcel_metadata (tenant_id, key);

CREATE INDEX IF NOT EXISTS parcel_evidence_tenant_parcel_idx
  ON parcel_evidence_docs (tenant_id, parcel_id);

CREATE INDEX IF NOT EXISTS parcel_activity_log_tenant_parcel_created_idx
  ON parcel_activity_log (tenant_id, parcel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS parcel_marketplace_inquiries_tenant_listing_idx
  ON parcel_marketplace_inquiries (tenant_id, listing_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Partial index — hot path for "active + public" marketplace browse.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS parcel_marketplace_listings_active_public_idx
  ON parcel_marketplace_listings (created_at DESC)
  WHERE listing_status = 'active' AND listing_visible_publicly = TRUE;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. public_parcel_listings_v — cross-tenant marketplace read view.
--
--    The ONLY path that bypasses RLS for cross-tenant marketplace
--    browsing. Pre-filters by (active + public_visible) and exposes a
--    safe column projection. Underlying writes still go through the
--    base table and remain RLS-isolated.
-- ─────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public_parcel_listings_v;

CREATE VIEW public_parcel_listings_v
WITH (security_invoker = false)
AS
SELECT
  l.id,
  l.tenant_id,
  l.parcel_id,
  l.land_area_id,
  l.listing_kind,
  l.title,
  l.description,
  l.asking_price_minor_units,
  l.currency_code,
  l.features_jsonb,
  l.image_urls,
  l.contact_method,
  l.created_at,
  l.updated_at,
  l.expires_at,
  -- Parcel snapshot for map preview (RLS-safe — we control projection).
  p.center_point   AS parcel_center_point,
  p.area_sqm       AS parcel_area_sqm,
  p.zoning         AS parcel_zoning,
  -- Land area snapshot for jurisdiction filter.
  la.jurisdiction  AS jurisdiction,
  la.region        AS region
FROM parcel_marketplace_listings l
LEFT JOIN parcels p ON p.id = l.parcel_id
LEFT JOIN land_areas la ON la.id = COALESCE(p.land_area_id, l.land_area_id)
WHERE l.listing_status = 'active'
  AND l.listing_visible_publicly = TRUE;

COMMENT ON VIEW public_parcel_listings_v IS
  'Piece N: cross-tenant marketplace read view. Pre-filters to active + public listings. SELECT-only for authenticated; writes go through the base table.';

GRANT SELECT ON public_parcel_listings_v TO authenticated;
GRANT SELECT ON public_parcel_listings_v TO anon;
