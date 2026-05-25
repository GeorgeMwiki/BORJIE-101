import { ScreenHeader } from '@/components/ScreenHeader';
import { PortfolioMapSurface } from '@/components/portfolio-map/PortfolioMapSurface';

/**
 * O-W-05 — Portfolio map.
 *
 * react-map-gl + Mapbox basemap with toggleable GeoJSON layers
 * (licences, sites, settlements, water, protected areas, roads).
 * Clicking a feature opens a detail card; sites link through to the
 * site cockpit. Gracefully degrades to a GeoJSON listing when
 * NEXT_PUBLIC_MAPBOX_TOKEN is unset.
 */
export default function PortfolioMapPage() {
  return (
    <>
      <ScreenHeader slug="portfolio-map" />
      <div className="px-8 py-6">
        <PortfolioMapSurface />
      </div>
    </>
  );
}
