// Deterministic mock distance so cards remain stable across renders.
// Real distance will come from gateway once geocoding is wired.

const regionDistanceKm: Readonly<Record<string, number>> = {
  Geita: 1085,
  Manyara: 420,
  Shinyanga: 870,
  Mbeya: 765,
  Ruvuma: 1240,
  Kagera: 1390
}

export function mockDistanceKm(originRegion: string): number {
  for (const key of Object.keys(regionDistanceKm)) {
    if (originRegion.toLowerCase().includes(key.toLowerCase())) {
      return regionDistanceKm[key] ?? 500
    }
  }
  // Deterministic hash so unknown regions still get a stable number.
  let hash = 0
  for (let i = 0; i < originRegion.length; i += 1) {
    hash = (hash * 31 + originRegion.charCodeAt(i)) & 0xffff
  }
  return 200 + (hash % 1200)
}

export function formatKm(km: number): string {
  return `${km.toLocaleString('en-GB')} km`
}
