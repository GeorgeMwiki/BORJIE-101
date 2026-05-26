'use client';

/**
 * GeoFenceInner — leaflet-dependent slice of GeoFence.
 *
 * Renders the map + optional fence Polygon. When `editable=true`, taps
 * append a point to the fence and emit `genui:geo-fence-change` with
 * the latest polygon. Read-only fences just render the polygon.
 *
 * Hardening (Wave 15D): `react-leaflet` is loaded via dynamic
 * `import()` inside `useEffect`, not via a top-level `import` —
 * because when this package is bundled with tsup `splitting: false`,
 * a top-level `import 'react-leaflet'` collapses into the dist
 * barrel and crashes SSR (leaflet touches `window` at module load).
 * Loading after mount keeps SSR safe even if the bundler eagerly
 * inlines this module.
 */

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';

import type { GeoFencePoint } from '../types';

interface MapClickEvent {
  readonly latlng: { readonly lat: number; readonly lng: number };
}
interface MapEventHandlers {
  readonly click?: (e: MapClickEvent) => void;
}
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
  readonly Polygon: ComponentType<{
    readonly positions: ReadonlyArray<[number, number]>;
    readonly pathOptions?: { readonly color?: string; readonly weight?: number };
  }>;
  readonly Marker: ComponentType<{
    readonly position: [number, number];
    readonly children?: ReactNode;
  }>;
  readonly useMapEvents: (handlers: MapEventHandlers) => void;
}

export interface GeoFenceInnerProps {
  readonly center: readonly [number, number];
  readonly zoom: number;
  readonly fence: ReadonlyArray<GeoFencePoint>;
  readonly editable: boolean;
  readonly onChangeAction?: string | undefined;
}

interface ClickCaptureProps {
  readonly enabled: boolean;
  readonly onAppend: (pt: GeoFencePoint) => void;
  readonly useMapEvents: ReactLeafletShape['useMapEvents'];
}

function ClickCapture({ enabled, onAppend, useMapEvents }: ClickCaptureProps): null {
  useMapEvents({
    click: (e) => {
      if (!enabled) return;
      onAppend({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export function GeoFenceInner(props: GeoFenceInnerProps): JSX.Element {
  const [RL, setRL] = useState<ReactLeafletShape | null>(null);
  const [fence, setFence] = useState<ReadonlyArray<GeoFencePoint>>(props.fence);

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

  const positions = fence.map((p) => [p.lat, p.lng] as [number, number]);

  function append(pt: GeoFencePoint): void {
    const next = [...fence, pt];
    setFence(next);
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(
          new CustomEvent('genui:geo-fence-change', {
            detail: { action: props.onChangeAction, fence: next },
          }),
        );
      } catch {
        /* ignore */
      }
    }
  }

  function reset(): void {
    setFence([]);
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(
          new CustomEvent('genui:geo-fence-change', {
            detail: { action: props.onChangeAction, fence: [] },
          }),
        );
      } catch {
        /* ignore */
      }
    }
  }

  if (!RL) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
        loading map…
      </div>
    );
  }

  const { MapContainer, TileLayer, Polygon, Marker, useMapEvents } = RL;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={props.center as [number, number]}
        zoom={props.zoom}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="© OpenStreetMap contributors"
        />
        <ClickCapture
          enabled={props.editable}
          onAppend={append}
          useMapEvents={useMapEvents}
        />
        {positions.length >= 3 ? (
          <Polygon positions={positions} pathOptions={{ color: '#1f6feb', weight: 2 }} />
        ) : null}
        {fence.map((p, i) => (
          <Marker key={i} position={[p.lat, p.lng] as [number, number]} />
        ))}
      </MapContainer>
      {props.editable ? (
        <button
          type="button"
          onClick={reset}
          className="absolute right-2 top-2 z-[1000] rounded border border-border bg-surface px-2 py-0.5 text-xs"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
