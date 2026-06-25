'use client';

import type { FeatureKind, MapFeature } from '@/lib/types/portfolio-map';
import { pickByLocale } from '@/lib/locale';
import type { Locale } from '@/lib/locale-shared';
import {
  portfolioMapStrings as S,
  featureKindLabels,
} from '@/i18n/strings/portfolio-map';

interface MapFallbackProps {
  readonly features: ReadonlyArray<MapFeature>;
  readonly enabled: ReadonlyArray<FeatureKind>;
  readonly onSelect: (feature: MapFeature) => void;
  readonly locale: Locale;
}

/**
 * Graceful degrade for the portfolio map when no Mapbox token is set.
 * Lists every visible feature in a token-aware card grid grouped by
 * kind so the owner still sees the portfolio shape, just without the
 * basemap tiles.
 */
export function MapFallback({ features, enabled, onSelect, locale }: MapFallbackProps) {
  const groups = enabled.map((kind) => ({
    kind,
    items: features.filter((f) => f.kind === kind),
  }));
  return (
    <div className="h-chart-lg overflow-y-auto rounded-lg border border-dashed border-border bg-surface/30 p-4">
      <div className="mb-3 text-xs text-muted-foreground">
        {pickByLocale(locale, S.fallbackNote)}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <div
            key={g.kind}
            className="rounded-md border border-border bg-surface px-3 py-2"
          >
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              {pickByLocale(locale, featureKindLabels[g.kind])} · {g.items.length}
            </div>
            {g.items.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                {pickByLocale(locale, S.noFeatures)}
              </div>
            ) : (
              <ul className="space-y-1 text-xs">
                {g.items.map((feature) => (
                  <li key={feature.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(feature)}
                      className="w-full rounded px-1 py-0.5 text-left text-muted-foreground hover:bg-surface/70 hover:text-foreground"
                    >
                      {feature.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
