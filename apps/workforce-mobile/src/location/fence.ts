/**
 * Site-fence runtime — loads polygons from configuration, never from
 * fabricated module-level constants.
 *
 * Wave 18Z-cleanup (SCRUB-3): the previous `MOCK_SITES` array was moved
 * to `__fixtures__/site-fences-fixture.ts` (test-only). Production
 * loads from the `EXPO_PUBLIC_BORJIE_SITE_FENCES_JSON` Expo env var (a
 * JSON-stringified `ReadonlyArray<SiteFence>`); if the env is absent or
 * malformed, `loadSiteFences()` returns an empty array and
 * `nearestFence()` returns `null` — callers are expected to surface a
 * "fences not configured" empty state to the worker rather than
 * silently leaking development coordinates.
 */
import type { Coordinates } from './useLocation'

export interface SiteFence {
  siteId: string
  siteName: string
  centerLat: number
  centerLng: number
  radiusMeters: number
}

/**
 * Parse the `EXPO_PUBLIC_BORJIE_SITE_FENCES_JSON` env var, validating
 * shape per-element. Drops any element that fails validation so a
 * single malformed entry cannot poison the fence list.
 *
 * Never throws — every parse error surfaces as an empty array so the
 * mobile UI can render a "fences not configured" state instead of a
 * crash.
 */
export function loadSiteFences(): ReadonlyArray<SiteFence> {
  const raw =
    typeof process !== 'undefined' && process.env
      ? process.env['EXPO_PUBLIC_BORJIE_SITE_FENCES_JSON']
      : undefined
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: SiteFence[] = []
    for (const candidate of parsed) {
      if (!candidate || typeof candidate !== 'object') continue
      const c = candidate as Record<string, unknown>
      if (
        typeof c['siteId'] !== 'string' ||
        typeof c['siteName'] !== 'string' ||
        typeof c['centerLat'] !== 'number' ||
        typeof c['centerLng'] !== 'number' ||
        typeof c['radiusMeters'] !== 'number'
      ) {
        continue
      }
      out.push({
        siteId: c['siteId'],
        siteName: c['siteName'],
        centerLat: c['centerLat'],
        centerLng: c['centerLng'],
        radiusMeters: c['radiusMeters'],
      })
    }
    return Object.freeze(out)
  } catch {
    return []
  }
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Haversine distance in metres between two coordinates. Good enough for
 * fences in the kilometre range — we don't need WGS84 precision here.
 */
export function distanceMeters(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number {
  const earthRadius = 6371000
  const dLat = toRadians(toLat - fromLat)
  const dLng = toRadians(toLng - fromLng)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(fromLat)) *
      Math.cos(toRadians(toLat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadius * c
}

export interface NearestFenceResult {
  fence: SiteFence
  distance: number
  insideFence: boolean
}

/**
 * Compute the nearest configured fence for the supplied coordinates.
 * Returns `null` when no fences are configured (env unset / malformed)
 * — the caller is expected to render a "fences not configured" state.
 *
 * `fencesOverride` is exposed so tests can pass a deterministic fence
 * set (see `__fixtures__/site-fences-fixture.ts`).
 */
export function nearestFence(
  coords: Coordinates,
  fencesOverride?: ReadonlyArray<SiteFence>
): NearestFenceResult | null {
  const fences = fencesOverride ?? loadSiteFences()
  if (fences.length === 0) {
    return null
  }
  let bestFence: SiteFence = fences[0]!
  let bestDistance = Number.POSITIVE_INFINITY
  for (const fence of fences) {
    const d = distanceMeters(
      coords.latitude,
      coords.longitude,
      fence.centerLat,
      fence.centerLng
    )
    if (d < bestDistance) {
      bestDistance = d
      bestFence = fence
    }
  }
  return {
    fence: bestFence,
    distance: bestDistance,
    insideFence: bestDistance <= bestFence.radiusMeters,
  }
}
