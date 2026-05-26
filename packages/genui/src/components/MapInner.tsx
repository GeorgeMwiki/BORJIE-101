'use client';

/**
 * MapInner — the leaflet-dependent slice of `MapView`. Kept in a
 * separate file so the parent can lazy-import it through
 * `ClientOnly` + `React.lazy` and keep the leaflet bundle out of SSR.
 *
 * Hardening (Wave 15D): `react-leaflet` is loaded via dynamic
 * `import()` inside `useEffect`, not via a top-level `import` —
 * because when this package is bundled with tsup `splitting: false`,
 * a top-level `import 'react-leaflet'` collapses into the dist
 * barrel and crashes SSR (leaflet touches `window` at module load).
 * Loading after mount keeps SSR safe even if the bundler eagerly
 * inlines this module.
 *
 * NOTE on offline-tile cache (tracked in #33): we declare a
 * `useTileCache=true` default, which currently has no effect — once
 * integration installs `leaflet.offline` we wire a localForage-backed
 * cache here.
 */

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import type { MapMarker } from '../types';

interface ReactLeafletShape {
  readonly MapContainer: ComponentType<{
    readonly center: [number, number];
    readonly zoom: number;
    readonly style?: React.CSSProperties;
    readonly children?: ReactNode;
  }>;
  readonly TileLayer: ComponentType<{
    readonly url: string;
    readonly attribution?: string;
  }>;
  readonly Marker: ComponentType<{
    readonly position: [number, number];
    readonly children?: ReactNode;
  }>;
  readonly Popup: ComponentType<{ readonly children?: ReactNode }>;
}

export interface MapInnerProps {
  readonly center: readonly [number, number];
  readonly zoom: number;
  readonly markers: ReadonlyArray<MapMarker>;
}

export function MapInner(props: MapInnerProps): JSX.Element {
  const [RL, setRL] = useState<ReactLeafletShape | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // @ts-ignore — peer dep of the consuming app
        const mod = await import('react-leaflet');
        if (!cancelled) setRL(mod as unknown as ReactLeafletShape);
      } catch {
        /* peer dep missing — render fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!RL) {
    return (
      <span className="text-xs text-muted-foreground" aria-live="polite">
        loading map…
      </span>
    );
  }

  const { MapContainer, TileLayer, Marker, Popup } = RL;

  return (
    <MapContainer
      center={props.center as [number, number]}
      zoom={props.zoom}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap contributors"
      />
      {props.markers.map((m, i) => (
        <Marker key={i} position={m.position as [number, number]}>
          {m.popup ? <Popup>{m.popup}</Popup> : null}
        </Marker>
      ))}
    </MapContainer>
  );
}
