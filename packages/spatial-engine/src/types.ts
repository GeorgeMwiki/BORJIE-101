/**
 * @borjie/spatial-engine — shared types.
 *
 * The full Muzima spatial parcel engine spec lives in
 * `.audit/litfin-sota-2026-05-23/17-spatial-parcel-engine.md`. This
 * file is the typed contract between the parcel-service backend, the
 * `<ParcelMap/>` React shell, and any analytics overlay consumer.
 *
 * All polygon rows carry `authoritativeSource` + `accuracyM`
 * provenance because EA cadastral APIs are non-public — the UI must
 * never assert legal ownership.
 */

// ============================================================================
// GeoJSON primitives (RFC 7946-shaped, narrowed for what Muzima stores)
// ============================================================================

export type Lon = number;
export type Lat = number;
export type Position = readonly [Lon, Lat] | readonly [Lon, Lat, number];

export interface GeoJsonPoint {
  readonly type: 'Point';
  readonly coordinates: Position;
}
export interface GeoJsonLineString {
  readonly type: 'LineString';
  readonly coordinates: readonly Position[];
}
export interface GeoJsonPolygon {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly Position[])[];
}
export interface GeoJsonMultiPolygon {
  readonly type: 'MultiPolygon';
  readonly coordinates: readonly (readonly (readonly Position[])[])[];
}
export type GeoJsonGeometry =
  | GeoJsonPoint
  | GeoJsonLineString
  | GeoJsonPolygon
  | GeoJsonMultiPolygon;

// ============================================================================
// Enums (mirror the SQL CHECK constraints in migration 0164)
// ============================================================================

export type AuthoritativeSource =
  | 'user_traced'
  | 'overture'
  | 'google_open_buildings'
  | 'osm'
  | 'sam_assisted'
  | 'gps_walk'
  | 'cadastral_authority'
  | 'microsoft_ml_footprints'
  | 'unknown';

export type OccupancyStatus =
  | 'vacant'
  | 'occupied'
  | 'reserved'
  | 'under_maintenance'
  | 'not_available'
  | 'unknown';

export type ElementStatus =
  | 'operational'
  | 'degraded'
  | 'broken'
  | 'needs_repair'
  | 'decommissioned'
  | 'unknown';

export type ElementCondition =
  | 'excellent'
  | 'good'
  | 'fair'
  | 'poor'
  | 'critical'
  | 'unknown';

export type RoomType =
  | 'bedroom'
  | 'bathroom'
  | 'kitchen'
  | 'living'
  | 'dining'
  | 'office'
  | 'storage'
  | 'utility'
  | 'balcony'
  | 'corridor'
  | 'commercial'
  | 'other';

export type MapLayerKind =
  | 'occupancy'
  | 'condition'
  | 'status'
  | 'arrears'
  | 'compliance'
  | 'maintenance'
  | 'rent_band'
  | 'custom';

// ============================================================================
// Provenance — every polygon row carries this
// ============================================================================

export interface Provenance {
  readonly authoritativeSource: AuthoritativeSource;
  /** RMS positional accuracy in metres. >= 0. */
  readonly accuracyM: number;
}

// ============================================================================
// Domain rows
// ============================================================================

export interface Parcel extends Provenance {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly name: string;
  readonly boundary: GeoJsonMultiPolygon;
  readonly centroid: GeoJsonPoint;
  readonly areaSqm: number;
  readonly h3R10?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Building extends Provenance {
  readonly id: string;
  readonly tenantId: string;
  readonly parcelId: string;
  readonly name: string;
  readonly footprint: GeoJsonPolygon;
  readonly heightM?: number;
  readonly numFloors: number;
  readonly h3R12?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Floor {
  readonly id: string;
  readonly tenantId: string;
  readonly buildingId: string;
  readonly level: number;
  readonly name: string;
  readonly outline?: GeoJsonPolygon;
  readonly areaSqm?: number;
  readonly heightM?: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Unit {
  readonly id: string;
  readonly tenantId: string;
  readonly floorId: string;
  readonly leasableUnitId?: string;
  readonly unitCode: string;
  readonly outline: GeoJsonPolygon;
  readonly areaSqm: number;
  readonly occupancyStatus: OccupancyStatus;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Room {
  readonly id: string;
  readonly tenantId: string;
  readonly parcelUnitId: string;
  readonly name: string;
  readonly roomType: RoomType;
  readonly outline: GeoJsonPolygon;
  readonly areaSqm: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Element {
  readonly id: string;
  readonly tenantId: string;
  readonly roomId?: string;
  readonly parcelUnitId?: string;
  readonly buildingId?: string;
  readonly elementType: string;
  readonly status: ElementStatus;
  readonly condition: ElementCondition;
  readonly geom: GeoJsonGeometry;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ElementPhoto {
  readonly id: string;
  readonly tenantId: string;
  readonly elementId: string;
  readonly storageUrl: string;
  readonly captureGeom?: GeoJsonPoint;
  readonly capturedAt: string; // ISO-8601
  readonly uploadedBy?: string;
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface MapLayer {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly layerKind: MapLayerKind;
  readonly style: Readonly<Record<string, unknown>>;
  readonly isDefault: boolean;
}

// ============================================================================
// Snap-to-building (used by parcel-service /snap-to-nearest-building)
// ============================================================================

export interface ReferenceBuilding {
  /** Source-specific id (Overture / Google Open Buildings). */
  readonly id: string;
  readonly source: 'overture' | 'google_open_buildings';
  readonly footprint: GeoJsonPolygon;
}

export interface SnapResult {
  readonly building: ReferenceBuilding;
  /** Great-circle distance between query point and candidate centroid (m). */
  readonly distanceM: number;
}

// ============================================================================
// MCP / API contracts
// ============================================================================

export interface BoundingBox {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

export interface GeocodeQuery {
  readonly address: string;
  readonly countryCode?: string;
}

export interface GeocodeResult {
  readonly provider: 'google' | 'plus_codes' | 'what3words' | 'nominatim';
  readonly formattedAddress: string;
  readonly point: GeoJsonPoint;
  readonly confidence: number; // 0..1
}
