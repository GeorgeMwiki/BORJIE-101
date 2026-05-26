'use client';

import type { FeatureKind, MapFeature } from '@/lib/types/portfolio-map';

interface MapFallbackProps {
  readonly features: ReadonlyArray<MapFeature>;
  readonly enabled: ReadonlyArray<FeatureKind>;
  readonly onSelect: (feature: MapFeature) => void;
}

/**
 * Graceful degrade for the portfolio map when no Mapbox token is set.
 * Lists every visible feature in a token-aware card grid grouped by
 * kind so the owner still sees the portfolio shape, just without the
 * basemap tiles.
 */
export function MapFallback({ features, enabled, onSelect }: MapFallbackProps) {
  const groups = enabled.map((kind) => ({
    kind,
    items: features.filter((f) => f.kind === kind),
  }));
  return (
    <div className="h-[560px] overflow-y-auto rounded-lg border border-dashed border-border bg-surface/30 p-4">
      <div className="mb-3 text-xs text-neutral-400">
        NEXT_PUBLIC_MAPBOX_TOKEN not set — showing the GeoJSON feature catalogue
        as a tile-free fallback.
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <div
            key={g.kind}
            className="rounded-md border border-border bg-surface px-3 py-2"
          >
            <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
              {g.kind} · {g.items.length}
            </div>
            {g.items.length === 0 ? (
              <div className="text-xs text-neutral-500">no features</div>
            ) : (
              <ul className="space-y-1 text-xs">
                {g.items.map((feature) => (
                  <li key={feature.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(feature)}
                      className="w-full rounded px-1 py-0.5 text-left text-neutral-300 hover:bg-surface/70 hover:text-foreground"
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
