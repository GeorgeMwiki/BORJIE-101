'use client';

/**
 * GeoFenceInner — leaflet-dependent slice of GeoFence.
 *
 * Renders the map + optional fence Polygon. When `editable=true`, taps
 * append a point to the fence and emit `genui:geo-fence-change` with
 * the latest polygon. Read-only fences just render the polygon.
 */

import { useState, type ComponentType, type ReactNode } from 'react';

// @ts-ignore — peer dep on the consuming app
import * as ReactLeaflet from 'react-leaflet';

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

const { MapContainer, TileLayer, Polygon, Marker, useMapEvents } =
  ReactLeaflet as unknown as ReactLeafletShape;

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
}

function ClickCapture({ enabled, onAppend }: ClickCaptureProps): null {
  useMapEvents({
    click: (e) => {
      if (!enabled) return;
      onAppend({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export function GeoFenceInner(props: GeoFenceInnerProps): JSX.Element {
  const [fence, setFence] = useState<ReadonlyArray<GeoFencePoint>>(props.fence);
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
        <ClickCapture enabled={props.editable} onAppend={append} />
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
