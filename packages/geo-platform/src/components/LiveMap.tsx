/**
 * <LiveMap/> — MapLibre GL v5 map shell with optional Aerial View 3D
 * tile overlay.
 *
 * Spec: `.audit/sota-2026-05-24/01-geo-platform.md` §1, §3.
 *
 * This component is intentionally minimal — most of the page-specific
 * UX (controls, drawer, etc.) lives in the apps that consume it. We
 * own three concerns:
 *   1. Initialise a MapLibre instance against a vector tile source.
 *   2. Toggle a Google 3D Photorealistic Tiles layer when requested.
 *   3. Forward `(lat, lng)` clicks via the `onMapClick` prop so the
 *      parent can wire painting / segmentation handlers.
 */

import { useEffect, useRef } from 'react';
import type { Lat, Lon } from '../types.js';

/** Minimal MapLibre shape — we don't import the type to keep the peer dep optional. */
interface MapLibreMap {
  on: (event: string, cb: (e: { lngLat: { lng: number; lat: number } }) => void) => void;
  off?: (event: string, cb: (e: unknown) => void) => void;
  remove: () => void;
  addSource?: (id: string, source: unknown) => void;
  removeSource?: (id: string) => void;
  addLayer?: (layer: unknown) => void;
  removeLayer?: (id: string) => void;
  getLayer?: (id: string) => unknown;
}

interface MapLibreModule {
  Map: new (config: unknown) => MapLibreMap;
}

export interface LiveMapProps {
  readonly center: { readonly lat: Lat; readonly lng: Lon };
  readonly zoom?: number;
  /** Vector tile style URL — defaults to a MapLibre demo style. */
  readonly styleUrl?: string;
  /** When true, overlays the Google Photorealistic 3D Tiles raster. */
  readonly show3D?: boolean;
  /** Optional Google Maps Tiles API key (read by the consumer). */
  readonly tilesApiKey?: string;
  readonly className?: string;
  readonly style?: React.CSSProperties;
  readonly onMapClick?: (point: { readonly lat: Lat; readonly lng: Lon }) => void;
  /** Inject a custom MapLibre instance — used by tests. */
  readonly maplibreOverride?: MapLibreModule;
}

const DEFAULT_STYLE = 'https://demotiles.maplibre.org/style.json';
const TILES_3D_LAYER_ID = 'google-3d-tiles';

function loadMapLibre(): MapLibreModule | null {
  // We lazily require maplibre-gl so the package can be imported on
  // the server without crashing.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('maplibre-gl') as MapLibreModule | { default?: MapLibreModule };
    if ('Map' in mod) return mod as MapLibreModule;
    if ((mod as { default?: MapLibreModule }).default) {
      return (mod as { default: MapLibreModule }).default;
    }
    return null;
  } catch {
    return null;
  }
}

export function LiveMap(props: LiveMapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const maplibre = props.maplibreOverride ?? loadMapLibre();
    if (!maplibre) {
      // We render the container; consumer can show a fallback.
      return undefined;
    }

    const map = new maplibre.Map({
      container,
      style: props.styleUrl ?? DEFAULT_STYLE,
      center: [props.center.lng, props.center.lat],
      zoom: props.zoom ?? 16,
      pitch: props.show3D ? 60 : 0,
      bearing: 0,
    });

    mapRef.current = map;

    const clickHandler = (e: { lngLat: { lng: number; lat: number } }): void => {
      if (props.onMapClick) {
        props.onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      }
    };
    map.on('click', clickHandler);

    // 3D tiles overlay (only when show3D and we have a key).
    if (props.show3D && props.tilesApiKey && map.addSource && map.addLayer) {
      try {
        map.addSource(TILES_3D_LAYER_ID, {
          type: 'raster',
          tiles: [
            // The 3D tileset root is JSON, but for the MapLibre raster
            // layer we treat it as a styled overlay. Apps that need the
            // full mesh swap in deck.gl's Tile3DLayer (see spec §1.2).
            `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(props.tilesApiKey)}`,
          ],
          tileSize: 256,
        });
        map.addLayer({ id: TILES_3D_LAYER_ID, type: 'raster', source: TILES_3D_LAYER_ID });
      } catch {
        // Style not loaded yet or unsupported — silently ignore; the
        // 2D vector style still renders.
      }
    }

    return () => {
      if (map.off) {
        map.off('click', clickHandler as unknown as (e: unknown) => void);
      }
      map.remove();
      mapRef.current = null;
    };
    // We intentionally key on the few stable props; downstream props
    // like onMapClick are mutable refs from the caller's render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.styleUrl,
    props.center.lat,
    props.center.lng,
    props.zoom,
    props.show3D,
    props.tilesApiKey,
    props.maplibreOverride,
  ]);

  return (
    <div
      ref={containerRef}
      className={props.className}
      style={{ width: '100%', height: '100%', ...props.style }}
      data-testid="geo-platform-live-map"
    />
  );
}
