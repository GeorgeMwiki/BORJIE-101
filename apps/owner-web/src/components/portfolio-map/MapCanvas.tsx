'use client';

import { useEffect, useState } from 'react';
import type { FeatureKind, MapFeature } from '@/lib/types/portfolio-map';
import { MAP_INITIAL_VIEW } from '@/lib/types/portfolio-map';

interface MapCanvasProps {
  readonly mapboxToken: string;
  readonly features: ReadonlyArray<MapFeature>;
  readonly enabled: ReadonlyArray<FeatureKind>;
  readonly onSelect: (feature: MapFeature) => void;
}

const KIND_COLOR: Record<FeatureKind, string> = {
  licence: '#f59e0b',
  site: '#22c55e',
  settlement: '#a3a3a3',
  water: '#3b82f6',
  protected: '#ec4899',
  road: '#d4d4d8',
};

/**
 * Mapbox/react-map-gl canvas. Imported dynamically so the heavy
 * vendor bundle only loads when this screen is hit and a token is
 * present. Falls back to the placeholder card when react-map-gl is
 * unavailable for any reason.
 */
export function MapCanvas({ mapboxToken, features, enabled, onSelect }: MapCanvasProps) {
  const [mapModule, setMapModule] = useState<typeof import('react-map-gl') | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import('react-map-gl');
        await import('./MapboxCss.jsx').catch(() => undefined);
        if (!cancelled) setMapModule(mod as unknown as typeof import('react-map-gl'));
      } catch {
        if (!cancelled) setMapModule(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!mapModule) {
    return (
      <div className="flex h-chart-lg items-center justify-center rounded-lg border border-dashed border-border bg-surface/30 text-sm text-neutral-400">
        Loading map…
      </div>
    );
  }

  const { default: Map, Source, Layer, Marker, NavigationControl } = mapModule;
  const visible = features.filter((f) => enabled.includes(f.kind));
  const polygons = visible.filter((f) => f.geometry.type === 'Polygon');
  const lines = visible.filter((f) => f.geometry.type === 'LineString');
  const points = visible.filter((f) => f.geometry.type === 'Point');

  return (
    <div className="h-chart-lg overflow-hidden rounded-lg border border-border">
      <Map
        mapboxAccessToken={mapboxToken}
        initialViewState={MAP_INITIAL_VIEW}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        style={{ width: '100%', height: '100%' }}
      >
        <NavigationControl position="top-right" />
        {polygons.map((feature) => (
          <Source
            key={feature.id}
            id={feature.id}
            type="geojson"
            data={{
              type: 'Feature',
              geometry: feature.geometry as never,
              properties: feature.properties,
            }}
          >
            <Layer
              id={`${feature.id}-fill`}
              type="fill"
              paint={{
                'fill-color': KIND_COLOR[feature.kind],
                'fill-opacity': 0.25,
              }}
            />
            <Layer
              id={`${feature.id}-line`}
              type="line"
              paint={{
                'line-color': KIND_COLOR[feature.kind],
                'line-width': 1.5,
              }}
            />
          </Source>
        ))}
        {lines.map((feature) => (
          <Source
            key={feature.id}
            id={feature.id}
            type="geojson"
            data={{
              type: 'Feature',
              geometry: feature.geometry as never,
              properties: feature.properties,
            }}
          >
            <Layer
              id={`${feature.id}-line`}
              type="line"
              paint={{
                'line-color': KIND_COLOR[feature.kind],
                'line-width': 2,
              }}
            />
          </Source>
        ))}
        {points.map((feature) => {
          const [lng, lat] = feature.geometry.coordinates as number[];
          return (
            <Marker
              key={feature.id}
              longitude={lng ?? 0}
              latitude={lat ?? 0}
              anchor="center"
            >
              <button
                type="button"
                onClick={() => onSelect(feature)}
                className="block h-3 w-3 rounded-full border-2 border-white"
                style={{ background: KIND_COLOR[feature.kind] }}
                title={feature.name}
              />
            </Marker>
          );
        })}
      </Map>
    </div>
  );
}
