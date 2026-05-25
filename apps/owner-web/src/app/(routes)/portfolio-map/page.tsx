import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-05 — Portfolio map.
 *
 * PostGIS + Mapbox surface for every spatial asset in the owner's
 * portfolio. Layers can be toggled independently so the owner can
 * answer "which licences are within 2 km of a settlement?" without
 * leaving the map.
 */
export default function PortfolioMapPage() {
  return (
    <>
      <ScreenHeader slug="portfolio-map" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 lg:grid-cols-4">
        <div className="lg:col-span-3">
          <div className="h-[560px] rounded-lg border border-dashed border-border bg-surface/30 p-6 text-sm text-neutral-400">
            Mapbox + PostGIS layers
            <div className="mt-2 text-xs text-neutral-500">
              Layers: licences · sites · settlements · water · protected areas · roads
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <PlaceholderCard title="Layer controls">
            Toggleable layer list with opacity sliders.
          </PlaceholderCard>
          <PlaceholderCard title="Spatial query">
            Buffer / intersection helpers — "within 2 km of any village".
          </PlaceholderCard>
        </div>
      </div>
    </>
  );
}
