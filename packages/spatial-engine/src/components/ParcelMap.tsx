/**
 * <ParcelMap/> — client-only React shell around MapLibre GL JS v5.
 *
 * Wires up:
 *   - MapLibre canvas + container resize observer
 *   - PMTiles / Martin vector source from `MARTIN_URL` + `MAPLIBRE_STYLE_URL`
 *   - Optional Geoman draw control (lazy-loaded)
 *   - `onParcelClick` event surfaced to the host
 *
 * MapLibre touches the DOM and *must not* render on the server. Next.js
 * consumers should wrap this in `dynamic(..., { ssr: false })` or
 * import it from a `'use client'` file.
 *
 * Spec: `.audit/litfin-sota-2026-05-23/17-spatial-parcel-engine.md`.
 */

import * as React from 'react';
import type { GeoJsonPoint, Parcel } from '../types.js';
import { logger } from '../logger.js';

// MapLibre & Geoman are PEER deps — typed as `any` here so the
// package's tsc run does not require the libraries to be installed in
// every workspace. Consumer apps install the real packages.
type AnyMap = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ParcelClickEvent {
  readonly parcelId: string;
  readonly point: GeoJsonPoint;
  readonly originalEvent: unknown;
}

export interface ParcelMapProps {
  /** Tenant context — sent to Martin for RLS-scoped tile queries. */
  readonly tenantId: string;
  /** Initial map centre + zoom. Defaults to Nairobi CBD. */
  readonly initialCenter?: readonly [number, number];
  readonly initialZoom?: number;
  /** MapLibre style URL. Falls back to `MAPLIBRE_STYLE_URL` env. */
  readonly styleUrl?: string;
  /** Martin server URL for vector tiles. Falls back to `MARTIN_URL` env. */
  readonly martinUrl?: string;
  /** Existing parcels to render as a GeoJSON layer (optional). */
  readonly parcels?: readonly Parcel[];
  /** Click handler for any parcel polygon. */
  readonly onParcelClick?: (event: ParcelClickEvent) => void;
  /** Enable Geoman draw control (requires peer dep `@geoman-io/maplibre-geoman-free`). */
  readonly enableDraw?: boolean;
  /** Extra className on the outer wrapper. */
  readonly className?: string;
  /** Inline style on the outer wrapper. */
  readonly style?: React.CSSProperties;
}

/** Nairobi CBD — Kenya is the default tenant region. */
const DEFAULT_CENTER: readonly [number, number] = [36.8219, -1.2921];
const DEFAULT_ZOOM = 12;

export function ParcelMap(props: ParcelMapProps): React.ReactElement {
  const {
    tenantId,
    initialCenter = DEFAULT_CENTER,
    initialZoom = DEFAULT_ZOOM,
    styleUrl,
    martinUrl,
    parcels,
    onParcelClick,
    enableDraw = false,
    className,
    style,
  } = props;

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<AnyMap | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Resolve URLs from env if not passed explicitly.
  const resolvedStyleUrl =
    styleUrl ??
    (typeof process !== 'undefined' ? process.env.MAPLIBRE_STYLE_URL : undefined) ??
    'https://demotiles.maplibre.org/style.json';

  const resolvedMartinUrl =
    martinUrl ??
    (typeof process !== 'undefined' ? process.env.MARTIN_URL : undefined);

  React.useEffect(() => {
    let cancelled = false;

    async function init() {
      if (typeof window === 'undefined') return; // SSR guard
      if (!containerRef.current) return;

      let maplibregl: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        // Dynamic import so consumers without maplibre installed still
        // get a clean tsc + bundle.
        maplibregl = await import(/* webpackChunkName: "maplibre" */ 'maplibre-gl').catch(() => null);
      } catch {
        maplibregl = null;
      }

      if (!maplibregl) {
        if (!cancelled) {
          setError(
            "maplibre-gl peer dependency not installed — install with `pnpm add maplibre-gl` in the host app.",
          );
        }
        return;
      }

      if (cancelled) return;

      const map = new maplibregl.Map({
        container: containerRef.current!,
        style: resolvedStyleUrl,
        center: initialCenter as [number, number],
        zoom: initialZoom,
      });

      mapRef.current = map;

      map.on('load', () => {
        if (cancelled) return;
        // Optional: hook a Martin-backed parcel layer.
        if (resolvedMartinUrl) {
          try {
            map.addSource('parcels', {
              type: 'vector',
              tiles: [`${resolvedMartinUrl}/parcels/{z}/{x}/{y}?tenant_id=${encodeURIComponent(tenantId)}`],
              minzoom: 10,
              maxzoom: 22,
            });
            map.addLayer({
              id: 'parcels-fill',
              type: 'fill',
              source: 'parcels',
              'source-layer': 'parcels',
              paint: {
                'fill-color': '#10B981',
                'fill-opacity': 0.25,
                'fill-outline-color': '#059669',
              },
            });
            map.on('click', 'parcels-fill', (e: any) => {
              const feature = e.features?.[0];
              if (!feature || !onParcelClick) return;
              const id = String(feature.properties?.id ?? feature.id ?? '');
              if (!id) return;
              onParcelClick({
                parcelId: id,
                point: {
                  type: 'Point',
                  coordinates: [e.lngLat.lng, e.lngLat.lat],
                },
                originalEvent: e,
              });
            });
          } catch (sourceErr) {
            logger.warn('[ParcelMap] failed to add Martin source', { sourceErr });
          }
        }

        // Optional GeoJSON overlay for in-memory parcels (admin preview).
        if (parcels && parcels.length > 0) {
          try {
            map.addSource('parcels-inline', {
              type: 'geojson',
              data: {
                type: 'FeatureCollection',
                features: parcels.map((p) => ({
                  type: 'Feature',
                  id: p.id,
                  properties: { id: p.id, name: p.name },
                  geometry: p.boundary,
                })),
              },
            });
            map.addLayer({
              id: 'parcels-inline-fill',
              type: 'fill',
              source: 'parcels-inline',
              paint: {
                'fill-color': '#3B82F6',
                'fill-opacity': 0.2,
              },
            });
          } catch (overlayErr) {
            logger.warn('[ParcelMap] inline overlay failed', { overlayErr });
          }
        }

        // Optional Geoman draw control. Declared as an OPTIONAL peer
        // dependency in package.json — the dynamic import is hidden
        // behind a Function() constructor so TypeScript does not try
        // to resolve the module at compile time. Runtime failure is
        // caught and silently disables draw.
        if (enableDraw) {
          // Hidden from TS module resolution because the dep is optional
          // and not in package.json. Wrapped in Function() so the bundler
          // and TS compiler don't try to resolve it at build time.
          // eslint-disable-next-line no-new-func
          const dynamicImport = new Function(
            'specifier',
            'return import(specifier);',
          ) as (specifier: string) => Promise<unknown>;
          dynamicImport('@geoman-io/maplibre-geoman-free')
            .then((geo) => {
              try {
                const mod = geo as { Geoman?: unknown; default?: unknown };
                const ctor = (mod.Geoman ?? mod.default) as
                  | (new (opts: Record<string, unknown>) => unknown)
                  | undefined;
                if (ctor && map.addControl) {
                  map.addControl(new ctor({}) as never);
                }
              } catch (drawErr) {
                logger.warn('[ParcelMap] Geoman init failed', { drawErr });
              }
            })
            .catch(() => {
              // Geoman not installed — fine, draw disabled silently.
            });
        }
      });
    }

    void init();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        try {
          mapRef.current.remove?.();
        } catch {
          /* ignore */
        }
        mapRef.current = null;
      }
    };
  }, [
    tenantId,
    resolvedStyleUrl,
    resolvedMartinUrl,
    initialCenter,
    initialZoom,
    enableDraw,
    onParcelClick,
    parcels,
  ]);

  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', ...style }}
    >
      <div
        ref={containerRef}
        data-testid="parcel-map-container"
        style={{ position: 'absolute', inset: 0 }}
      />
      {error ? (
        <div
          role="alert"
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            padding: '8px 12px',
            background: 'rgba(220, 38, 38, 0.9)',
            color: 'white',
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
