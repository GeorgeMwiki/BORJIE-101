'use client';

/**
 * ParcelMap — Leaflet wrapper.
 *
 * Loaded via next/dynamic with ssr:false from GeoAdvisorClient so
 * Leaflet's `window`-touching imports never run during SSR.
 *
 * Paints each parcel polygon over an OpenStreetMap tile layer. The
 * currently selected parcel is rendered with a stronger fill so the
 * operator can see which row matches the side-panel insights.
 */

import { useEffect, useRef } from 'react';
import * as ReactLeaflet from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// react-leaflet 4.x ships forward-ref'd components whose prop types
// erase to `IntrinsicAttributes` under nodenext + module resolution.
// We re-export them as broadly-typed React components so the JSX
// site type-checks. The runtime behaviour is unchanged.
type AnyProps = Readonly<Record<string, unknown>> & {
  readonly children?: React.ReactNode;
};
const MapContainer = ReactLeaflet.MapContainer as unknown as (
  props: AnyProps,
) => JSX.Element;
const TileLayer = ReactLeaflet.TileLayer as unknown as (
  props: AnyProps,
) => JSX.Element;
const Polygon = ReactLeaflet.Polygon as unknown as (
  props: AnyProps,
) => JSX.Element;
const { useMap } = ReactLeaflet;

export interface PaintedParcel {
  readonly id: string;
  readonly label: string;
  readonly polygon: ReadonlyArray<readonly [number, number]>;
  readonly color?: string;
  readonly center: { readonly lat: number; readonly lng: number };
}

export interface ParcelMapProps {
  readonly center: [number, number];
  readonly zoom: number;
  readonly parcels: ReadonlyArray<PaintedParcel>;
  readonly selectedParcelId?: string | null;
  readonly onParcelClick?: (p: PaintedParcel) => void;
}

export function ParcelMap({
  center,
  zoom,
  parcels,
  selectedParcelId,
  onParcelClick,
}: ParcelMapProps): JSX.Element {
  return (
    <div className="w-full h-[480px] rounded-md overflow-hidden border border-border">
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ width: '100%', height: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {parcels.map((p) => {
          const isSelected = p.id === selectedParcelId;
          // Leaflet wants `[lat, lng]` pairs — the GeoJSON convention
          // is `[lng, lat]`; the advisor response is already in the
          // Leaflet order so we forward as-is.
          return (
            <Polygon
              key={p.id}
              positions={p.polygon as [number, number][]}
              pathOptions={{
                color: p.color ?? '#f59e0b',
                weight: isSelected ? 3 : 1.5,
                fillColor: p.color ?? '#f59e0b',
                fillOpacity: isSelected ? 0.45 : 0.15,
              }}
              eventHandlers={{
                click: () => onParcelClick?.(p),
              }}
            />
          );
        })}
        <ParcelFocus parcels={parcels} selectedParcelId={selectedParcelId} />
      </MapContainer>
    </div>
  );
}

/**
 * Recenter on the selected parcel so the operator's eye never has to
 * hunt the map for it. Pure side-effect — renders nothing.
 */
function ParcelFocus({
  parcels,
  selectedParcelId,
}: {
  readonly parcels: ReadonlyArray<PaintedParcel>;
  readonly selectedParcelId?: string | null;
}): null {
  const map = useMap();
  const lastFocused = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedParcelId || selectedParcelId === lastFocused.current) return;
    const parcel = parcels.find((p) => p.id === selectedParcelId);
    if (!parcel) return;
    map.flyTo([parcel.center.lat, parcel.center.lng], Math.max(map.getZoom(), 15), {
      duration: 0.6,
    });
    lastFocused.current = selectedParcelId;
  }, [map, parcels, selectedParcelId]);
  return null;
}
