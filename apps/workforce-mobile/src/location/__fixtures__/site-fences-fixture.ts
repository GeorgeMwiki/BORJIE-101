/**
 * Site-fence fixtures used by location-related unit tests only.
 *
 * Wave 18Z-cleanup (SCRUB-3): moved out of `src/location/fence.ts` so
 * the runtime `nearestFence` no longer ships fabricated coordinates to
 * the workforce app. Production fences load from the
 * `EXPO_PUBLIC_BORJIE_SITE_FENCES_JSON` env (see `fence.ts` →
 * `loadSiteFences`).
 *
 * These fixtures are TEST-ONLY. Do NOT import from runtime code.
 */
import type { SiteFence } from '../fence'

export const FIXTURE_SITE_FENCES: ReadonlyArray<SiteFence> = [
  {
    siteId: 'site-geita-1',
    siteName: 'Geita Pit 2',
    centerLat: -3.4287,
    centerLng: 32.9183,
    radiusMeters: 2500,
  },
  {
    siteId: 'site-mwanza-1',
    siteName: 'Mwanza Block A',
    centerLat: -2.5164,
    centerLng: 32.9175,
    radiusMeters: 2000,
  },
]
