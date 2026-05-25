/**
 * @borjie/geo-intelligence — typed contract.
 *
 * Field-driven geo-intelligence engine: parcels, segmentation, metadata
 * layers, association graph, event-sourced history, and field captures.
 *
 * Composes with `@borjie/geo-platform` (Google Maps Live + geofence)
 * and `@borjie/spatial-engine` (ParcelMap + color-coding). All
 * GeoJSON shapes are RFC 7946-compliant.
 */

// ============================================================================
// GeoJSON primitives — narrowed; mirrors geo-platform for cross-package compat
// ============================================================================

export type Lon = number;
export type Lat = number;
/** `[lon, lat]` (RFC 7946 §3.1.1). 3rd element is optional altitude in metres. */
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
  /** First ring is outer, subsequent rings are holes. */
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

export interface BoundingBox {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

// ============================================================================
// Parcel identity + status
// ============================================================================

export type ParcelId = string;
export type TenantId = string;
export type OrgId = string;
export type UserId = string;
export type CaptureId = string;
export type EventId = string;
export type SegmentId = string;
export type LayerId = string;

export type ParcelStatus =
  | 'active'
  | 'pending'
  | 'disposed'
  | 'subdivided'
  | 'merged'
  | 'disputed';

export interface Parcel {
  readonly parcelId: ParcelId;
  readonly tenantId: TenantId;
  readonly orgId: OrgId;
  readonly parentParcelId?: ParcelId;
  readonly name: string;
  readonly description?: string;
  readonly geometry: GeoJsonMultiPolygon;
  readonly centroid: GeoJsonPoint;
  readonly areaSqm: number;
  readonly status: ParcelStatus;
  readonly registryNumber?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string; // ISO-8601
  readonly updatedAt: string; // ISO-8601
}

// ============================================================================
// Metadata layers (6 standard + custom)
// ============================================================================

export type MetadataLayerKind =
  | 'legal'
  | 'physical'
  | 'financial'
  | 'environmental'
  | 'social'
  | 'infrastructure'
  | 'custom';

export interface MetadataLayer<T = Record<string, unknown>> {
  readonly layerId: LayerId;
  readonly parcelId: ParcelId;
  readonly tenantId: TenantId;
  readonly kind: MetadataLayerKind;
  readonly data: Readonly<T>;
  readonly source?: string;
  /** [0,1] confidence. */
  readonly confidence?: number;
  readonly recordedAt: string;
  readonly recordedBy?: UserId;
}

// ============================================================================
// Segmentation
// ============================================================================

export type SegmentKind = 'zoning' | 'physical' | 'functional' | 'tenure' | 'custom';

export interface ParcelSegment {
  readonly segmentId: SegmentId;
  readonly parcelId: ParcelId;
  readonly tenantId: TenantId;
  readonly kind: SegmentKind;
  readonly name?: string;
  readonly geometry: GeoJsonPolygon;
  readonly colorHex?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type SegmentationDimension =
  | 'zoning'
  | 'status'
  | 'revenue_band'
  | 'sustainability_score'
  | 'tenure'
  | 'age'
  | 'market_segment';

export type ColorScaleId =
  | 'viridis'
  | 'plasma'
  | 'rdylgn'
  | 'categorical-12';

export interface SegmentationView {
  readonly parcelId: ParcelId;
  readonly color: string;
  readonly label: string;
  readonly value: number | string;
}

// ============================================================================
// Association graph
// ============================================================================

export type GraphNodeKind =
  | 'parcel'
  | 'segment'
  | 'unit'
  | 'lease'
  | 'tenant'
  | 'payment'
  | 'document'
  | 'maintenance_event'
  | 'communication'
  | 'survey'
  | 'photo'
  | 'drone_footage'
  | 'sensor_reading'
  | 'conditional_survey_report';

export interface GraphNode {
  readonly kind: GraphNodeKind;
  readonly id: string;
  readonly label?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface GraphEdge {
  readonly from: GraphNode;
  readonly to: GraphNode;
  /** e.g. "occupies", "owns", "captured-at", "issued-for". */
  readonly relation: string;
  readonly weight?: number;
  readonly at?: string;
}

export interface AssociationSubgraph {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges: ReadonlyArray<GraphEdge>;
}

// ============================================================================
// Event-sourced history
// ============================================================================

export type ParcelEventKind =
  | 'polygon_changed'
  | 'metadata_updated'
  | 'photo_added'
  | 'video_added'
  | 'audio_note_added'
  | 'inspection_recorded'
  | 'unit_created'
  | 'unit_modified'
  | 'lease_attached'
  | 'tenant_moved_in'
  | 'tenant_moved_out'
  | 'payment_recorded'
  | 'maintenance_request'
  | 'survey_completed'
  | 'valuation_changed'
  | 'boundary_disputed'
  | 'boundary_resolved'
  | 'subdivided'
  | 'merged'
  | 'acquired'
  | 'disposed';

export interface ParcelEvent {
  readonly eventId: EventId;
  readonly parcelId: ParcelId;
  readonly tenantId: TenantId;
  readonly kind: ParcelEventKind;
  readonly actorUserId?: UserId;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly evidenceRefs: ReadonlyArray<string>;
}

// ============================================================================
// Field captures
// ============================================================================

export type CaptureKind =
  | 'photo'
  | 'video'
  | 'audio'
  | 'inspection'
  | 'polygon'
  | 'sensor'
  | 'drone'
  | 'pano';

export type CaptureStatus = 'queued' | 'processed' | 'rejected';

export interface FieldCapture {
  readonly captureId: CaptureId;
  readonly tenantId: TenantId;
  readonly surveyorUserId: UserId;
  readonly parcelId?: ParcelId;
  readonly kind: CaptureKind;
  readonly capturedAt: string;
  readonly capturedLocation?: GeoJsonPoint;
  readonly storageUri?: string;
  readonly c2paSignature?: string;
  readonly exifMetadata?: Readonly<Record<string, unknown>>;
  readonly aiInferences?: Readonly<Record<string, unknown>>;
  readonly status: CaptureStatus;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface ExifGps {
  readonly lat: Lat;
  readonly lng: Lon;
  readonly ts?: string;
  readonly deviceModel?: string;
  readonly altitudeM?: number;
}

// ============================================================================
// Imagery providers
// ============================================================================

export interface SatelliteImage {
  readonly providerId: string;
  readonly capturedAt: string;
  readonly tileUrl: string;
  readonly bbox: BoundingBox;
  readonly resolutionM?: number;
  readonly cloudCoverPct?: number;
}

export interface StreetViewPano {
  readonly providerId: string;
  readonly panoId: string;
  readonly capturedAt: string;
  readonly location: GeoJsonPoint;
  readonly headingDeg?: number;
  readonly pitchDeg?: number;
  readonly imageUrl: string;
}

export interface DroneFootage {
  readonly providerId: string;
  readonly footageId: string;
  readonly capturedAt: string;
  readonly trajectory?: GeoJsonLineString;
  readonly altitudeRangeM?: { readonly min: number; readonly max: number };
  readonly videoUrl: string;
  readonly thumbnailUrl?: string;
}

// ============================================================================
// Compliance overlays
// ============================================================================

export type Jurisdiction = 'TZ' | 'KE' | 'UG' | 'RW';

export type ZoningClass =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'agricultural'
  | 'mixed_use'
  | 'institutional'
  | 'recreational'
  | 'protected'
  | 'unknown';

export interface ZoningOverlay {
  readonly jurisdiction: Jurisdiction;
  readonly parcelId: ParcelId;
  readonly zoningClass: ZoningClass;
  readonly authority: string;
  readonly source?: string;
  readonly evaluatedAt: string;
}

export type FloodRiskBand = 'none' | 'low' | 'moderate' | 'high' | 'extreme';

export interface FloodRiskOverlay {
  readonly parcelId: ParcelId;
  readonly band: FloodRiskBand;
  readonly returnPeriodYears?: number;
  readonly source: string;
}

export type LegalTitleStatus = 'clean' | 'pending' | 'disputed' | 'unknown';

export interface LegalTitleOverlay {
  readonly parcelId: ParcelId;
  readonly status: LegalTitleStatus;
  readonly jurisdiction: Jurisdiction;
  readonly source?: string;
}

// ============================================================================
// Result envelope (mirrors geo-platform)
// ============================================================================

export interface OkResult<T> {
  readonly ok: true;
  readonly data: T;
}

export interface ErrorResult {
  readonly ok: false;
  readonly error: {
    readonly kind: string;
    readonly message: string;
    readonly status?: number;
  };
}

export type Result<T> = OkResult<T> | ErrorResult;
