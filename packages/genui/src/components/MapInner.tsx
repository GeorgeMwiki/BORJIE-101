'use client';

/**
 * MapInner — the leaflet-dependent slice of `MapView`. Kept in a
 * separate file so the parent can lazy-import it through
 * `ClientOnly` + `React.lazy` and keep the leaflet bundle out of SSR.
 *
 * NOTE on offline-tile cache (tracked in #33): we declare a `useTileCache=true`
 * default, which currently has no effect — once integration installs
 * `leaflet.offline` we wire a localForage-backed cache here.
 */

// react-leaflet is a peer dep on the consuming app. The destructure
// pulls the runtime contract (MapContainer + TileLayer + Marker +
// Popup) that matches react-leaflet v4 exactly, but the types may not
// be present during package build, so we declare a minimal local shape.
// @ts-ignore — module is a peer dep of the consuming app
import * as ReactLeaflet from 'react-leaflet';

import type { ComponentType, ReactNode } from 'react';
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

const { MapContainer, TileLayer, Marker, Popup } = ReactLeaflet as unknown as ReactLeafletShape;

export interface MapInnerProps {
  readonly center: readonly [number, number];
  readonly zoom: number;
  readonly markers: ReadonlyArray<MapMarker>;
}

export function MapInner(props: MapInnerProps): JSX.Element {
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
