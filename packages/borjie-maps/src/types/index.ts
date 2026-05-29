/**
 * @borjie/maps — shared type contracts.
 *
 * Same shape consumed by the React (web) and React Native bindings so
 * a screen written for owner-web compiles unchanged on workforce-mobile.
 *
 * Companion to Docs/RESEARCH/GEO_SOTA_2026-05-29.md §3.
 */

// ---------------------------------------------------------------------------
// Primitive geo types
// ---------------------------------------------------------------------------

export interface BorjieLngLat {
  readonly lng: number;
  readonly lat: number;
}

export interface BorjieViewState {
  readonly center: BorjieLngLat;
  readonly zoom: number;
  /** Optional bearing in degrees (0 = north up). */
  readonly bearing?: number;
  /** Optional pitch in degrees (0 = flat, 60 = max). */
  readonly pitch?: number;
}

export interface BorjieBounds {
  readonly southWest: BorjieLngLat;
  readonly northEast: BorjieLngLat;
}

// ---------------------------------------------------------------------------
// Style + locale
// ---------------------------------------------------------------------------

export const BORJIE_MAP_THEMES = ['light', 'dark', 'satellite'] as const;
export type BorjieMapTheme = (typeof BORJIE_MAP_THEMES)[number];

export const BORJIE_MAP_LOCALES = ['sw', 'en'] as const;
export type BorjieMapLocale = (typeof BORJIE_MAP_LOCALES)[number];

export interface BorjieMapStyleConfig {
  readonly theme: BorjieMapTheme;
  readonly locale: BorjieMapLocale;
  /** Override the default demotiles URL with a self-hosted style URL. */
  readonly styleUrlOverride?: string;
}

/**
 * The default style URL — points at MapLibre's free demo tiles. Override
 * via `EXPO_PUBLIC_BORJIE_MAP_STYLE_URL` / `NEXT_PUBLIC_BORJIE_MAP_STYLE_URL`
 * in production to a self-hosted MapTiler or Stadia style.
 */
export const BORJIE_DEFAULT_STYLE_URL =
  'https://demotiles.maplibre.org/style.json';

// ---------------------------------------------------------------------------
// Layer feature shapes — what the BorjieMap renders.
// ---------------------------------------------------------------------------

export const BORJIE_LAYER_KINDS = [
  'site',
  'hazard',
  'licence',
  'regulatory',
  'worker',
  'route',
  'custody-trace',
] as const;
export type BorjieLayerKind = (typeof BORJIE_LAYER_KINDS)[number];

export interface BorjieMarker {
  readonly id: string;
  readonly position: BorjieLngLat;
  /** Bilingual label (object). The map picks the active locale field. */
  readonly label?: { readonly sw: string; readonly en: string };
  /** Optional icon override (e.g. "pit" | "fuel" | "magazine"). */
  readonly icon?: string;
  /** layerKind drives default styling. */
  readonly layerKind: BorjieLayerKind;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface BorjiePolygon {
  readonly id: string;
  /** GeoJSON Polygon coordinates ([[[lng,lat], ...]]). */
  readonly coordinates: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  readonly fillColor?: string;
  readonly outlineColor?: string;
  readonly opacity?: number;
  readonly layerKind: BorjieLayerKind;
  readonly label?: { readonly sw: string; readonly en: string };
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface BorjiePolyline {
  readonly id: string;
  readonly coordinates: ReadonlyArray<readonly [number, number]>;
  readonly color?: string;
  readonly widthPx?: number;
  readonly layerKind: BorjieLayerKind;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Component props — identical between web + native bindings.
// ---------------------------------------------------------------------------

export interface BorjieMapProps {
  /** Initial viewport. The component is uncontrolled by default. */
  readonly initialView: BorjieViewState;
  /** Style + locale config; defaults to light + en. */
  readonly style?: Partial<BorjieMapStyleConfig>;
  /** Marker features rendered on top of all polygons. */
  readonly markers?: ReadonlyArray<BorjieMarker>;
  /** Polygon features (sites, hazards, licences, regulatory). */
  readonly polygons?: ReadonlyArray<BorjiePolygon>;
  /** Polyline features (routes, chain-of-custody trace). */
  readonly polylines?: ReadonlyArray<BorjiePolyline>;
  /** Optional fit-bounds override; supersedes initialView when set. */
  readonly fitToBounds?: BorjieBounds;
  /** Locale override; falls back to `style.locale` then sw. */
  readonly locale?: BorjieMapLocale;
  /** Marker click handler. */
  readonly onMarkerPress?: (markerId: string) => void;
  /** Polygon click handler. */
  readonly onPolygonPress?: (polygonId: string) => void;
  /** Long-press handler — workforce mobile uses this to drop a pin. */
  readonly onLongPress?: (position: BorjieLngLat) => void;
  /** Optional className for web; ignored on native. */
  readonly className?: string;
  /** Optional inline style — width/height for web; viewStyle on native. */
  readonly viewStyle?: Readonly<Record<string, string | number>>;
}

// ---------------------------------------------------------------------------
// Helpers consumed by both bindings.
// ---------------------------------------------------------------------------

export function pickLabel(
  label: { readonly sw: string; readonly en: string } | undefined,
  locale: BorjieMapLocale,
): string | undefined {
  if (!label) return undefined;
  return label[locale] ?? label.sw;
}

/**
 * Resolve the effective style URL. The override wins, otherwise we
 * pick a per-theme default. Satellite uses the MapLibre demo
 * raster style; light + dark use the named demotiles.
 */
export function resolveStyleUrl(config: Partial<BorjieMapStyleConfig>): string {
  if (config.styleUrlOverride) return config.styleUrlOverride;
  const theme = config.theme ?? 'light';
  switch (theme) {
    case 'satellite':
      return 'https://api.maptiler.com/maps/satellite/style.json';
    case 'dark':
      return 'https://demotiles.maplibre.org/style.json';
    case 'light':
    default:
      return BORJIE_DEFAULT_STYLE_URL;
  }
}

/**
 * Compute the bounding box that encloses every feature passed in.
 * Returns null when no features are supplied — callers should fall
 * back to `initialView` in that case.
 */
export function boundsOf(
  markers: ReadonlyArray<BorjieMarker> = [],
  polygons: ReadonlyArray<BorjiePolygon> = [],
  polylines: ReadonlyArray<BorjiePolyline> = [],
): BorjieBounds | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const consider = (lng: number, lat: number): void => {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  };

  for (const m of markers) {
    consider(m.position.lng, m.position.lat);
  }
  for (const p of polygons) {
    for (const ring of p.coordinates) {
      for (const coord of ring) {
        consider(coord[0], coord[1]);
      }
    }
  }
  for (const l of polylines) {
    for (const coord of l.coordinates) {
      consider(coord[0], coord[1]);
    }
  }

  if (
    minLng === Infinity ||
    minLat === Infinity ||
    maxLng === -Infinity ||
    maxLat === -Infinity
  ) {
    return null;
  }

  return Object.freeze({
    southWest: Object.freeze({ lng: minLng, lat: minLat }),
    northEast: Object.freeze({ lng: maxLng, lat: maxLat }),
  });
}

/**
 * Convert a GeoJSON Polygon (text or object) into a `BorjiePolygon`
 * tagged with the supplied layer kind. Returns null on parse error so
 * the map renders the rest of the features without crashing.
 */
export function fromGeoJsonPolygon(
  raw: string | Record<string, unknown> | null | undefined,
  id: string,
  layerKind: BorjieLayerKind,
  label?: { readonly sw: string; readonly en: string },
): BorjiePolygon | null {
  if (raw == null) return null;
  let parsed: Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else {
    parsed = raw;
  }
  const type = parsed['type'];
  const coords = parsed['coordinates'];
  if (type !== 'Polygon' || !Array.isArray(coords)) return null;
  // Validate at least one ring with at least 4 coordinates.
  const rings = coords as ReadonlyArray<unknown>;
  const validRings: Array<ReadonlyArray<readonly [number, number]>> = [];
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) continue;
    const points: Array<readonly [number, number]> = [];
    for (const point of ring) {
      if (
        !Array.isArray(point) ||
        point.length < 2 ||
        typeof point[0] !== 'number' ||
        typeof point[1] !== 'number'
      ) {
        continue;
      }
      points.push([point[0], point[1]] as const);
    }
    if (points.length >= 4) {
      validRings.push(Object.freeze(points));
    }
  }
  if (validRings.length === 0) return null;
  return Object.freeze({
    id,
    coordinates: Object.freeze(validRings),
    layerKind,
    ...(label !== undefined && { label }),
  });
}
