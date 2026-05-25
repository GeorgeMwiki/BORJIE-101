/**
 * Piece N — persistence port.
 *
 * The geo-parcels package speaks to the database through this port. A
 * Drizzle/Postgres adapter lives in services/api-gateway (or wherever
 * connection management is owned); tests pass an in-memory
 * implementation. Keeping the surface narrow means RLS is enforced at
 * the adapter layer, not here.
 */

import type {
  LandArea,
  Parcel,
  ParcelMetadata,
  ParcelEvidence,
  MarketplaceListing,
  MarketplaceInquiry,
  ActivityLogRow,
  ColorTag,
  MarketplaceSearchFilters,
} from './types.js';

/**
 * The minimum interface the geo-parcels package needs. Adapters wire
 * each method to SQL with `current_app_tenant_id` set via GUC.
 */
export interface GeoParcelsPort {
  // ─── land_areas ───────────────────────────────────────────────────
  insertLandArea(row: LandArea): Promise<LandArea>;
  getLandArea(id: string, tenantId: string): Promise<LandArea | null>;
  listLandAreas(tenantId: string): Promise<LandArea[]>;

  // ─── parcels ──────────────────────────────────────────────────────
  insertParcel(row: Parcel): Promise<Parcel>;
  insertParcelsBatch(rows: Parcel[]): Promise<Parcel[]>;
  getParcel(id: string, tenantId: string): Promise<Parcel | null>;
  listParcelsByLandArea(landAreaId: string, tenantId: string): Promise<Parcel[]>;
  listChildrenOf(parentParcelId: string, tenantId: string): Promise<Parcel[]>;
  updateParcelStatus(
    id: string,
    tenantId: string,
    next: Parcel['status'],
  ): Promise<Parcel>;
  updateParcel(id: string, tenantId: string, patch: Partial<Parcel>): Promise<Parcel>;

  // ─── parcel_metadata ──────────────────────────────────────────────
  upsertParcelMetadata(row: ParcelMetadata): Promise<ParcelMetadata>;
  listParcelMetadata(parcelId: string, tenantId: string): Promise<ParcelMetadata[]>;

  // ─── parcel_evidence_docs ────────────────────────────────────────
  insertEvidence(row: ParcelEvidence): Promise<ParcelEvidence>;
  listEvidence(parcelId: string, tenantId: string): Promise<ParcelEvidence[]>;

  // ─── parcel_marketplace_listings ─────────────────────────────────
  insertListing(row: MarketplaceListing): Promise<MarketplaceListing>;
  getListing(id: string, tenantId: string): Promise<MarketplaceListing | null>;
  updateListing(
    id: string,
    tenantId: string,
    patch: Partial<MarketplaceListing>,
  ): Promise<MarketplaceListing>;
  /**
   * Cross-tenant public read — hits the `public_parcel_listings_v` view.
   * The adapter MUST query the view (not the base table) so RLS is
   * intentionally bypassed for active+public rows only.
   */
  searchPublicListings(filters: MarketplaceSearchFilters): Promise<MarketplaceListing[]>;

  // ─── parcel_marketplace_inquiries ────────────────────────────────
  insertInquiry(row: MarketplaceInquiry): Promise<MarketplaceInquiry>;
  listInquiriesForListing(listingId: string, tenantId: string): Promise<MarketplaceInquiry[]>;

  // ─── parcel_activity_log ─────────────────────────────────────────
  insertActivityLog(row: ActivityLogRow): Promise<ActivityLogRow>;
  listActivityLog(parcelId: string, tenantId: string): Promise<ActivityLogRow[]>;
  /** Latest hash for hash-chain construction. */
  getLatestActivityHash(parcelId: string, tenantId: string): Promise<string | null>;

  // ─── parcel_color_tags ───────────────────────────────────────────
  insertColorTag(row: ColorTag): Promise<ColorTag>;
  listColorTags(tenantId: string): Promise<ColorTag[]>;
}
