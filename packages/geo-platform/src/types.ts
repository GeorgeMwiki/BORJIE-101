/**
 * @borjie/geo-platform — typed contract.
 *
 * The full SOTA research lives in `.audit/sota-2026-05-24/01-geo-platform.md`.
 * This file is the single source of truth for the shapes returned by
 * every client, geofence event, and advisory bundle in this package.
 *
 * All shapes use `readonly` fields and immutable structures so callers
 * can never accidentally mutate a cached response.
 */

// ============================================================================
// GeoJSON primitives (RFC 7946 — narrowed)
// ============================================================================

export type Lon = number;
export type Lat = number;
/** `[lon, lat]` or `[lon, lat, altitudeM]`. */
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
// Result envelope — every real-fetch client returns this
// ============================================================================

export interface OkResult<T> {
  readonly ok: true;
  readonly data: T;
}

export type GeoErrorKind =
  | 'missing_api_key'
  | 'network'
  | 'timeout'
  | 'http_error'
  | 'invalid_response'
  | 'aborted'
  | 'rate_limited'
  | 'forbidden'
  | 'not_found'
  | 'unsupported_region';

export interface ErrorResult {
  readonly ok: false;
  readonly error: {
    readonly kind: GeoErrorKind;
    /** Human-readable, safe to surface in the UI. */
    readonly message: string;
    /** HTTP status, if applicable. */
    readonly status?: number;
  };
}

export type GeoResult<T> = OkResult<T> | ErrorResult;

// ============================================================================
// Client-call options (shared)
// ============================================================================

export interface ClientCallOptions {
  /** Default 10_000 ms. */
  readonly timeoutMs?: number;
  /** Caller-provided AbortSignal (composes with the internal timeout). */
  readonly signal?: AbortSignal;
  /** Per-call override; otherwise read lazily from `GOOGLE_MAPS_API_KEY`. */
  readonly apiKey?: string;
}

// ============================================================================
// Google Aerial View
// ============================================================================

export type AerialViewState = 'PROCESSING' | 'ACTIVE' | 'FAILED';

export interface AerialViewVideo {
  readonly name: string;
  readonly uri: string;
  readonly imageUri?: string;
  readonly state: AerialViewState;
  readonly mediaFormat?: 'MP4' | 'WEBM' | 'IMAGE';
}

export interface AerialViewLookupInput {
  readonly lat: Lat;
  readonly lng: Lon;
  /** Optional human label; the API may use it to bias the framing. */
  readonly addressDescriptor?: string;
}

// ============================================================================
// Google Solar API
// ============================================================================

export interface SolarRoofSegment {
  readonly pitchDegrees: number;
  readonly azimuthDegrees: number;
  readonly areaSqm: number;
  readonly sunshineHoursPerYear: number;
}

export interface SolarPotential {
  readonly maxArrayPanelsCount: number;
  readonly maxArrayAreaSqm: number;
  readonly maxSunshineHoursPerYear: number;
  readonly carbonOffsetFactorKgPerMwh: number;
  readonly roofSegments: readonly SolarRoofSegment[];
}

export interface SolarBuildingInsights {
  readonly name: string;
  readonly center: { readonly lat: Lat; readonly lng: Lon };
  readonly postalCode?: string;
  readonly regionCode?: string;
  readonly imageryQuality: 'HIGH' | 'MEDIUM' | 'LOW' | 'BASE';
  readonly imageryDate?: { readonly year: number; readonly month: number; readonly day: number };
  readonly solarPotential: SolarPotential;
}

// ============================================================================
// Google Air Quality API
// ============================================================================

export interface AirQualityPollutant {
  readonly code: string; // "pm25", "pm10", "no2", "o3", "so2", "co"
  readonly displayName: string;
  readonly fullName: string;
  readonly concentration: { readonly value: number; readonly units: string };
}

export interface AirQualityIndex {
  readonly code: string; // "uaqi" (Universal AQI) or "loc" (local index)
  readonly displayName: string;
  readonly aqi: number;
  readonly category: string;
  readonly dominantPollutant?: string;
  readonly color?: { readonly red: number; readonly green: number; readonly blue: number };
}

export interface AirQualitySnapshot {
  readonly dateTime: string;
  readonly regionCode?: string;
  readonly indexes: readonly AirQualityIndex[];
  readonly pollutants: readonly AirQualityPollutant[];
}

// ============================================================================
// Google Pollen API
// ============================================================================

export type PollenType = 'GRASS' | 'TREE' | 'WEED';

export interface PollenTypeInfo {
  readonly code: PollenType;
  readonly displayName: string;
  readonly indexInfo?: { readonly value: number; readonly category: string };
  readonly healthRecommendations?: readonly string[];
}

export interface PollenDailyForecast {
  readonly date: { readonly year: number; readonly month: number; readonly day: number };
  readonly pollenTypeInfo: readonly PollenTypeInfo[];
}

export interface PollenForecast {
  readonly regionCode?: string;
  readonly dailyInfo: readonly PollenDailyForecast[];
}

// ============================================================================
// Google Routes API
// ============================================================================

export type RoutingPreference =
  | 'TRAFFIC_UNAWARE'
  | 'TRAFFIC_AWARE'
  | 'TRAFFIC_AWARE_OPTIMAL';

export interface RouteWaypoint {
  readonly lat: Lat;
  readonly lng: Lon;
}

export interface RouteSummary {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly staticDurationSeconds?: number;
  readonly encodedPolyline?: string;
}

export interface RoutesComputeInput {
  readonly origin: RouteWaypoint;
  readonly destination: RouteWaypoint;
  readonly travelMode?: 'DRIVE' | 'WALK' | 'BICYCLE' | 'TRANSIT' | 'TWO_WHEELER';
  readonly routingPreference?: RoutingPreference;
  readonly departureTime?: Date;
}

// ============================================================================
// Google Address Validation API
// ============================================================================

export type AddressValidationGranularity =
  | 'GRANULARITY_UNSPECIFIED'
  | 'SUB_PREMISE'
  | 'PREMISE'
  | 'PREMISE_PROXIMITY'
  | 'BLOCK'
  | 'ROUTE'
  | 'OTHER';

export interface AddressValidationResult {
  readonly formattedAddress: string;
  readonly validationGranularity: AddressValidationGranularity;
  readonly hasInferredComponents: boolean;
  readonly hasUnconfirmedComponents: boolean;
  readonly geocode?: { readonly lat: Lat; readonly lng: Lon };
  readonly placeId?: string;
}

// ============================================================================
// Geofence
// ============================================================================

export type GeofenceId = string;

export interface GeoFence {
  readonly id: GeofenceId;
  readonly label: string;
  readonly polygon: GeoJsonPolygon;
  /** Optional inward / outward buffer in metres; positive = dilate. */
  readonly bufferM?: number;
  /** Free-form colour token consumed by the renderer. */
  readonly color?: string;
  /** Owner / tenant / role this fence applies to. */
  readonly scope?: { readonly tenantId?: string; readonly assigneeId?: string };
}

export type GeofenceEventKind = 'enter' | 'exit' | 'dwell';

export interface GeofenceEvent {
  readonly kind: GeofenceEventKind;
  readonly fenceId: GeofenceId;
  readonly subjectId: string;
  readonly point: GeoJsonPoint;
  readonly at: string; // ISO-8601
  /** Only for `dwell` events. */
  readonly dwellMs?: number;
}

// ============================================================================
// Reference buildings (footprint snap)
// ============================================================================

export type FootprintSource =
  | 'google_open_buildings'
  | 'overture'
  | 'microsoft_ml_footprints'
  | 'osm'
  | 'cadastral_authority';

export interface ReferenceBuilding {
  readonly id: string;
  readonly source: FootprintSource;
  readonly polygon: GeoJsonPolygon;
  /** Source-reported confidence in [0, 1]; if absent, treat as 0.5. */
  readonly confidence?: number;
  /** Centroid cache; the snapper recomputes if missing. */
  readonly centroid?: GeoJsonPoint;
}

export interface SnapResult {
  readonly building: ReferenceBuilding;
  readonly distanceM: number;
  readonly source: FootprintSource;
}

// ============================================================================
// Segmentation (SAM 2.1 / fallback)
// ============================================================================

export interface SamSegmentationInput {
  /** Public image URL or `data:` URL. */
  readonly imageUrl: string;
  /** Click position in image pixel space (0,0 = top-left). */
  readonly clickPx: { readonly x: number; readonly y: number };
  /** Optional negative clicks the user used to refine the mask. */
  readonly negativeClicksPx?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

export interface SamMaskPolygon {
  /** Pixel-space polygon — the consumer georeferences via the image tile bounds. */
  readonly pixelPolygon: ReadonlyArray<readonly [number, number]>;
  /** Mask score in [0, 1]. */
  readonly score: number;
}

// ============================================================================
// Area Insights bundle
// ============================================================================

export interface DriveTimeSample {
  readonly destinationLabel: string;
  readonly destination: RouteWaypoint;
  readonly durationSeconds: number;
  readonly distanceMeters: number;
}

export interface AreaInsights {
  readonly center: { readonly lat: Lat; readonly lng: Lon };
  readonly fetchedAt: string;
  readonly solar?: SolarBuildingInsights;
  readonly airQuality?: AirQualitySnapshot;
  readonly pollen?: PollenForecast;
  readonly driveTimes: readonly DriveTimeSample[];
  /** Per-section error envelope so partial data is still surfaceable. */
  readonly errors: {
    readonly solar?: ErrorResult['error'];
    readonly airQuality?: ErrorResult['error'];
    readonly pollen?: ErrorResult['error'];
    readonly routes?: ErrorResult['error'];
  };
}
