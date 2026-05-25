/**
 * In-memory implementation of GeoParcelsPort for testing.
 *
 * Mimics RLS by filtering on tenant_id at read time. The public
 * marketplace view is faked by filtering all listings by
 * (status='active' AND visible_publicly=true) — i.e. exactly what
 * `public_parcel_listings_v` does in 0260.
 *
 * Spatial filters in `searchPublicListings` use Cartesian helpers
 * from polygon-math (the real adapter delegates to PostGIS).
 */

import type {
  ActivityLogRow,
  ColorTag,
  LandArea,
  MarketplaceInquiry,
  MarketplaceListing,
  MarketplaceSearchFilters,
  Parcel,
  ParcelEvidence,
  ParcelMetadata,
} from '../types.js';
import type { GeoParcelsPort } from '../persistence-port.js';
import { bboxIntersects, polygonBoundingBox } from '../polygon-math.js';

export class InMemoryPort implements GeoParcelsPort {
  public readonly landAreas = new Map<string, LandArea>();
  public readonly parcels = new Map<string, Parcel>();
  public readonly metadata = new Map<string, ParcelMetadata>();
  public readonly evidence = new Map<string, ParcelEvidence>();
  public readonly listings = new Map<string, MarketplaceListing>();
  public readonly inquiries = new Map<string, MarketplaceInquiry>();
  public readonly activityLog = new Map<string, ActivityLogRow>();
  public readonly colorTags = new Map<string, ColorTag>();

  // ─── land_areas ────────────────────────────────────────────────────
  async insertLandArea(row: LandArea): Promise<LandArea> {
    this.landAreas.set(row.id, { ...row });
    return { ...row };
  }
  async getLandArea(id: string, tenantId: string): Promise<LandArea | null> {
    const row = this.landAreas.get(id);
    if (!row || row.tenant_id !== tenantId) return null;
    return { ...row };
  }
  async listLandAreas(tenantId: string): Promise<LandArea[]> {
    return [...this.landAreas.values()].filter((r) => r.tenant_id === tenantId);
  }

  // ─── parcels ───────────────────────────────────────────────────────
  async insertParcel(row: Parcel): Promise<Parcel> {
    this.parcels.set(row.id, { ...row });
    return { ...row };
  }
  async insertParcelsBatch(rows: Parcel[]): Promise<Parcel[]> {
    for (const r of rows) this.parcels.set(r.id, { ...r });
    return rows.map((r) => ({ ...r }));
  }
  async getParcel(id: string, tenantId: string): Promise<Parcel | null> {
    const row = this.parcels.get(id);
    if (!row || row.tenant_id !== tenantId) return null;
    return { ...row };
  }
  async listParcelsByLandArea(landAreaId: string, tenantId: string): Promise<Parcel[]> {
    return [...this.parcels.values()].filter(
      (r) => r.land_area_id === landAreaId && r.tenant_id === tenantId,
    );
  }
  async listChildrenOf(parentParcelId: string, tenantId: string): Promise<Parcel[]> {
    return [...this.parcels.values()].filter(
      (r) => r.parent_parcel_id === parentParcelId && r.tenant_id === tenantId,
    );
  }
  async updateParcelStatus(
    id: string,
    tenantId: string,
    next: Parcel['status'],
  ): Promise<Parcel> {
    const existing = this.parcels.get(id);
    if (!existing || existing.tenant_id !== tenantId) {
      throw new Error(`parcel ${id} not found for tenant ${tenantId}`);
    }
    const updated: Parcel = {
      ...existing,
      status: next,
      status_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.parcels.set(id, updated);
    return { ...updated };
  }
  async updateParcel(
    id: string,
    tenantId: string,
    patch: Partial<Parcel>,
  ): Promise<Parcel> {
    const existing = this.parcels.get(id);
    if (!existing || existing.tenant_id !== tenantId) {
      throw new Error(`parcel ${id} not found for tenant ${tenantId}`);
    }
    const updated: Parcel = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    this.parcels.set(id, updated);
    return { ...updated };
  }

  // ─── metadata ──────────────────────────────────────────────────────
  async upsertParcelMetadata(row: ParcelMetadata): Promise<ParcelMetadata> {
    const compositeKey = `${row.parcel_id}::${row.key}`;
    this.metadata.set(compositeKey, { ...row });
    return { ...row };
  }
  async listParcelMetadata(parcelId: string, tenantId: string): Promise<ParcelMetadata[]> {
    return [...this.metadata.values()].filter(
      (r) => r.parcel_id === parcelId && r.tenant_id === tenantId,
    );
  }

  // ─── evidence ──────────────────────────────────────────────────────
  async insertEvidence(row: ParcelEvidence): Promise<ParcelEvidence> {
    this.evidence.set(row.id, { ...row });
    return { ...row };
  }
  async listEvidence(parcelId: string, tenantId: string): Promise<ParcelEvidence[]> {
    return [...this.evidence.values()].filter(
      (r) => r.parcel_id === parcelId && r.tenant_id === tenantId,
    );
  }

  // ─── listings ──────────────────────────────────────────────────────
  async insertListing(row: MarketplaceListing): Promise<MarketplaceListing> {
    this.listings.set(row.id, { ...row });
    return { ...row };
  }
  async getListing(id: string, tenantId: string): Promise<MarketplaceListing | null> {
    const row = this.listings.get(id);
    if (!row || row.tenant_id !== tenantId) return null;
    return { ...row };
  }
  async updateListing(
    id: string,
    tenantId: string,
    patch: Partial<MarketplaceListing>,
  ): Promise<MarketplaceListing> {
    const existing = this.listings.get(id);
    if (!existing || existing.tenant_id !== tenantId) {
      throw new Error(`listing ${id} not found for tenant ${tenantId}`);
    }
    const updated: MarketplaceListing = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    this.listings.set(id, updated);
    return { ...updated };
  }

  /**
   * Fake the public_parcel_listings_v view:
   * 1. Only active + listing_visible_publicly=true rows.
   * 2. No tenant filter — this is the cross-tenant read path.
   */
  async searchPublicListings(
    filters: MarketplaceSearchFilters,
  ): Promise<MarketplaceListing[]> {
    let rows = [...this.listings.values()].filter(
      (r) => r.listing_status === 'active' && r.listing_visible_publicly === true,
    );

    if (filters.listing_kind) {
      rows = rows.filter((r) => r.listing_kind === filters.listing_kind);
    }
    if (filters.currency_code) {
      rows = rows.filter((r) => r.currency_code === filters.currency_code);
    }
    if (filters.min_price_minor_units != null) {
      rows = rows.filter(
        (r) =>
          r.asking_price_minor_units != null &&
          r.asking_price_minor_units >= filters.min_price_minor_units!,
      );
    }
    if (filters.max_price_minor_units != null) {
      rows = rows.filter(
        (r) =>
          r.asking_price_minor_units != null &&
          r.asking_price_minor_units <= filters.max_price_minor_units!,
      );
    }
    // Spatial filter — bbox vs parcel boundary bbox.
    if (filters.bounding_box) {
      const bbox = filters.bounding_box;
      rows = rows.filter((r) => {
        if (!r.parcel_id) return false;
        const parcel = this.parcels.get(r.parcel_id);
        if (!parcel) return false;
        const parcelBbox = polygonBoundingBox(parcel.boundary_polygon);
        return bboxIntersects(parcelBbox, bbox);
      });
    }
    // Jurisdiction / region join.
    if (filters.jurisdiction || filters.region) {
      rows = rows.filter((r) => {
        if (!r.parcel_id) return true;
        const parcel = this.parcels.get(r.parcel_id);
        if (!parcel) return true;
        const la = this.landAreas.get(parcel.land_area_id);
        if (!la) return true;
        if (filters.jurisdiction && la.jurisdiction !== filters.jurisdiction) return false;
        if (filters.region && la.region !== filters.region) return false;
        return true;
      });
    }
    // Zoning filter (via parcel).
    if (filters.zoning) {
      rows = rows.filter((r) => {
        if (!r.parcel_id) return false;
        const parcel = this.parcels.get(r.parcel_id);
        return parcel?.zoning === filters.zoning;
      });
    }
    // Area filter (via parcel).
    if (filters.min_area_sqm != null) {
      rows = rows.filter((r) => {
        if (!r.parcel_id) return false;
        const parcel = this.parcels.get(r.parcel_id);
        return (parcel?.area_sqm ?? 0) >= filters.min_area_sqm!;
      });
    }
    if (filters.max_area_sqm != null) {
      rows = rows.filter((r) => {
        if (!r.parcel_id) return false;
        const parcel = this.parcels.get(r.parcel_id);
        return (parcel?.area_sqm ?? Infinity) <= filters.max_area_sqm!;
      });
    }

    rows.sort((a, b) => {
      const aT = String(a.created_at ?? '');
      const bT = String(b.created_at ?? '');
      return bT.localeCompare(aT);
    });

    return rows.slice(filters.offset, filters.offset + filters.limit).map((r) => ({ ...r }));
  }

  // ─── inquiries ─────────────────────────────────────────────────────
  async insertInquiry(row: MarketplaceInquiry): Promise<MarketplaceInquiry> {
    this.inquiries.set(row.id, { ...row });
    return { ...row };
  }
  async listInquiriesForListing(listingId: string, tenantId: string): Promise<MarketplaceInquiry[]> {
    return [...this.inquiries.values()].filter(
      (r) => r.listing_id === listingId && r.tenant_id === tenantId,
    );
  }

  // ─── activity log ──────────────────────────────────────────────────
  async insertActivityLog(row: ActivityLogRow): Promise<ActivityLogRow> {
    this.activityLog.set(row.id, { ...row });
    return { ...row };
  }
  async listActivityLog(parcelId: string, tenantId: string): Promise<ActivityLogRow[]> {
    const rows = [...this.activityLog.values()].filter(
      (r) => r.parcel_id === parcelId && r.tenant_id === tenantId,
    );
    rows.sort((a, b) => {
      const aT = String(a.created_at ?? '');
      const bT = String(b.created_at ?? '');
      return aT.localeCompare(bT);
    });
    return rows;
  }
  async getLatestActivityHash(parcelId: string, tenantId: string): Promise<string | null> {
    const rows = await this.listActivityLog(parcelId, tenantId);
    if (rows.length === 0) return null;
    return rows[rows.length - 1]!.hash;
  }

  // ─── color tags ────────────────────────────────────────────────────
  async insertColorTag(row: ColorTag): Promise<ColorTag> {
    this.colorTags.set(row.id, { ...row });
    return { ...row };
  }
  async listColorTags(tenantId: string): Promise<ColorTag[]> {
    return [...this.colorTags.values()].filter((r) => r.tenant_id === tenantId);
  }
}

// ─── Test fixtures ────────────────────────────────────────────────────

/**
 * A 100m x 100m square in Dar es Salaam centred at (39.27, -6.82).
 * Bounding box is conveniently small so other helpers can verify
 * containment with predictable maths.
 */
export const TEST_LAND_AREA_POLYGON = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [39.270, -6.821],
      [39.272, -6.821],
      [39.272, -6.819],
      [39.270, -6.819],
      [39.270, -6.821],
    ],
  ],
};

/** Lower-left quadrant child polygon (inside TEST_LAND_AREA_POLYGON). */
export const TEST_CHILD_LL = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [39.2705, -6.8205],
      [39.2710, -6.8205],
      [39.2710, -6.8200],
      [39.2705, -6.8200],
      [39.2705, -6.8205],
    ],
  ],
};

/** Upper-right quadrant child polygon (inside, non-overlapping with LL). */
export const TEST_CHILD_UR = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [39.2715, -6.8195],
      [39.2718, -6.8195],
      [39.2718, -6.8192],
      [39.2715, -6.8192],
      [39.2715, -6.8195],
    ],
  ],
};

/** A polygon that OVERLAPS with TEST_CHILD_LL. */
export const TEST_CHILD_OVERLAPPING = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [39.2708, -6.8203],
      [39.2712, -6.8203],
      [39.2712, -6.8199],
      [39.2708, -6.8199],
      [39.2708, -6.8203],
    ],
  ],
};

/** A polygon that is OUTSIDE TEST_LAND_AREA_POLYGON. */
export const TEST_CHILD_OUT_OF_BOUNDS = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [39.300, -6.800],
      [39.302, -6.800],
      [39.302, -6.798],
      [39.300, -6.798],
      [39.300, -6.800],
    ],
  ],
};
