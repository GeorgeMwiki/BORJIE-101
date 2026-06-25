'use client';

import { useState } from 'react';
import { type FeatureKind, type MapFeature } from '@/lib/types/portfolio-map';
import { usePortfolioMap } from '@/lib/queries/portfolio-map';
import { useLocale, pickByLocale } from '@/lib/locale';
import type { Locale } from '@/lib/locale-shared';
import { portfolioMapStrings as S } from '@/i18n/strings/portfolio-map';
import { LayerControls } from './LayerControls';
import { MapCanvas } from './MapCanvas';
import { MapFallback } from './MapFallback';
import { FeatureDetail } from './FeatureDetail';

const DEFAULT_LAYERS: ReadonlyArray<FeatureKind> = [
  'licence',
  'site',
  'settlement',
  'water',
  'protected',
  'road',
];

/**
 * Portfolio map surface (O-W-05).
 *
 * Pulls features from the live gateway via `usePortfolioMap` (which
 * adapts the gateway's FeatureCollection into the front-end's MapFeature
 * shape, and falls back to the bundled mock when the gateway is
 * unreachable). Renders Mapbox via react-map-gl when
 * NEXT_PUBLIC_MAPBOX_TOKEN is present; otherwise renders the listing
 * fallback. Layer toggles work in both modes.
 *
 * Locale is SEEDED from the server-resolved cookie (`initialLocale`) so the
 * layer panel + fallback list paint in the active language on the first
 * frame (no EN-under-SW split-brain); `useLocale` still tracks mid-session
 * toggles. The seed is threaded to the map canvas / fallback so the whole
 * surface renders one language.
 */
export function PortfolioMapSurface({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
}) {
  const locale = useLocale(initialLocale);
  const mapboxToken =
    (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_MAPBOX_TOKEN) || '';
  const [enabled, setEnabled] = useState<ReadonlyArray<FeatureKind>>(DEFAULT_LAYERS);
  const [selected, setSelected] = useState<MapFeature | null>(null);
  const query = usePortfolioMap();
  const features = query.data?.features ?? [];

  const toggle = (kind: FeatureKind): void => {
    setEnabled((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
      <div className="lg:col-span-3">
        {mapboxToken ? (
          <MapCanvas
            mapboxToken={mapboxToken}
            features={features}
            enabled={enabled}
            onSelect={setSelected}
            locale={locale}
          />
        ) : (
          <MapFallback
            features={features}
            enabled={enabled}
            onSelect={setSelected}
            locale={locale}
          />
        )}
      </div>
      <div className="space-y-3">
        <div className="rounded-md border border-border bg-surface/40 px-3 py-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            {pickByLocale(locale, S.layersHeader)}
          </div>
          <LayerControls enabled={enabled} onToggle={toggle} locale={locale} />
        </div>
        <FeatureDetail
          feature={selected}
          onClose={() => setSelected(null)}
          locale={locale}
        />
      </div>
    </div>
  );
}
