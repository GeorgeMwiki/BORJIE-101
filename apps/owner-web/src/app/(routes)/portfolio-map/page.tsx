import { ScreenHeader } from '@/components/ScreenHeader';
import { PortfolioMapSurface } from '@/components/portfolio-map/PortfolioMapSurface';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

/**
 * O-W-05 — Portfolio map.
 *
 * react-map-gl + Mapbox basemap with toggleable GeoJSON layers
 * (licences, sites, settlements, water, protected areas, roads).
 * Clicking a feature opens a detail card; sites link through to the
 * site cockpit. Gracefully degrades to a GeoJSON listing when
 * NEXT_PUBLIC_MAPBOX_TOKEN is unset.
 *
 * Resolves the locale ONCE on the server and seeds the client surface so
 * the layer panel + fallback list paint in the active language on the
 * first frame (no EN-under-SW split-brain).
 */
export default async function PortfolioMapPage() {
  const initialLocale = await readLocaleFromServerCookies();
  return (
    <>
      <ScreenHeader slug="portfolio-map" />
      <div className="px-8 py-6">
        <PortfolioMapSurface initialLocale={initialLocale} />
      </div>
    </>
  );
}
