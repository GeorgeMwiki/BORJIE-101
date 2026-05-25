import type { Coordinates } from './useLocation'

export interface SiteFence {
  siteId: string
  siteName: string
  centerLat: number
  centerLng: number
  radiusMeters: number
}

/**
 * Hard-coded site fences used until the sites endpoint is wired. Mock check
 * for "is GPS within site polygon" uses a simple circular fence — good enough
 * to gate the W-M-07 drill-hole and W-M-19 attendance flows in dev.
 */
export const MOCK_SITES: ReadonlyArray<SiteFence> = [
  {
    siteId: 'site-geita-1',
    siteName: 'Geita Pit 2',
    centerLat: -3.4287,
    centerLng: 32.9183,
    radiusMeters: 2500
  },
  {
    siteId: 'site-mwanza-1',
    siteName: 'Mwanza Block A',
    centerLat: -2.5164,
    centerLng: 32.9175,
    radiusMeters: 2000
  }
]

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

export function nearestFence(coords: Coordinates): NearestFenceResult | null {
  if (MOCK_SITES.length === 0) {
    return null
  }
  let bestFence: SiteFence = MOCK_SITES[0]!
  let bestDistance = Number.POSITIVE_INFINITY
  for (const fence of MOCK_SITES) {
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
    insideFence: bestDistance <= bestFence.radiusMeters
  }
}
