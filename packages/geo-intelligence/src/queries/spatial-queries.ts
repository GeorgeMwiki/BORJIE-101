/**
 * Spatial queries — in-memory implementations.
 *
 * In production each of these is delegated to PostGIS via the
 * field-capture-service / api-gateway. The in-memory implementations
 * here exist so:
 *
 *   1. Unit tests can run without a database
 *   2. The mobile estate-manager-app can answer "what parcel did I
 *      just step on?" locally when the user is offline
 *
 * Performance: the implementations are intentionally simple (linear
 * scan, no R-tree). For tenant-scale workloads (<10_000 parcels) this
 * is comfortably <10 ms per query in Node 20.
 */

import type {
  BoundingBox,
  GeoJsonPoint,
  GeoJsonPolygon,
  Parcel,
  ParcelId,
} from '../types.js';
import { pointInPolygon, polygonBoundingBox } from '../geometry/polygon-ops.js';

const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;

function haversineDistanceM(
  a: { readonly lat: number; readonly lng: number },
  b: { readonly lat: number; readonly lng: number },
): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG_TO_RAD) *
      Math.cos(b.lat * DEG_TO_RAD) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(sa)));
}

function bboxIntersects(a: BoundingBox, b: BoundingBox): boolean {
  return !(
    a.maxLon < b.minLon ||
    a.minLon > b.maxLon ||
    a.maxLat < b.minLat ||
    a.minLat > b.maxLat
  );
}

export interface SpatialIndex {
  readonly all: () => ReadonlyArray<Parcel>;
  readonly pointInParcel: (lat: number, lng: number) => Parcel | null;
  readonly parcelsWithin: (bbox: BoundingBox) => ReadonlyArray<Parcel>;
  readonly nearestParcels: (
    lat: number,
    lng: number,
    k: number,
  ) => ReadonlyArray<{ readonly parcel: Parcel; readonly distanceM: number }>;
  readonly parcelsIntersecting: (polygon: GeoJsonPolygon) => ReadonlyArray<Parcel>;
  readonly withinDistance: (
    parcelId: ParcelId,
    distanceM: number,
  ) => ReadonlyArray<{ readonly parcel: Parcel; readonly distanceM: number }>;
}

export function createSpatialIndex(parcels: ReadonlyArray<Parcel>): SpatialIndex {
  // Pre-compute bbox + centroid lookup.
  const enriched = parcels.map((p) => ({
    parcel: p,
    bbox: polygonBoundingBox(p.geometry),
    centroid: {
      lat: p.centroid.coordinates[1],
      lng: p.centroid.coordinates[0],
    },
  }));
  const byId = new Map<ParcelId, (typeof enriched)[number]>();
  for (const e of enriched) byId.set(e.parcel.parcelId, e);

  return Object.freeze({
    all(): ReadonlyArray<Parcel> {
      return parcels;
    },
    pointInParcel(lat: number, lng: number): Parcel | null {
      const point: GeoJsonPoint = { type: 'Point', coordinates: [lng, lat] };
      for (const e of enriched) {
        if (lng < e.bbox.minLon || lng > e.bbox.maxLon) continue;
        if (lat < e.bbox.minLat || lat > e.bbox.maxLat) continue;
        if (pointInPolygon(point, e.parcel.geometry)) return e.parcel;
      }
      return null;
    },
    parcelsWithin(bbox: BoundingBox): ReadonlyArray<Parcel> {
      return enriched
        .filter((e) => bboxIntersects(e.bbox, bbox))
        .map((e) => e.parcel);
    },
    nearestParcels(lat: number, lng: number, k: number) {
      const sorted = enriched
        .map((e) => ({
          parcel: e.parcel,
          distanceM: haversineDistanceM({ lat, lng }, e.centroid),
        }))
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, Math.max(0, k));
      return sorted;
    },
    parcelsIntersecting(polygon: GeoJsonPolygon): ReadonlyArray<Parcel> {
      const polyBbox = polygonBoundingBox(polygon);
      const hits: Parcel[] = [];
      for (const e of enriched) {
        if (!bboxIntersects(e.bbox, polyBbox)) continue;
        // Approximate: if any vertex of one is inside the other, count it.
        const polyOuter = polygon.coordinates[0] ?? [];
        let intersects = false;
        for (const pt of polyOuter) {
          if (
            pointInPolygon(
              { type: 'Point', coordinates: [pt[0], pt[1]] },
              e.parcel.geometry,
            )
          ) {
            intersects = true;
            break;
          }
        }
        if (!intersects) {
          // Try parcel centroid in the query polygon.
          if (pointInPolygon(e.parcel.centroid, polygon)) {
            intersects = true;
          }
        }
        if (intersects) hits.push(e.parcel);
      }
      return hits;
    },
    withinDistance(parcelId: ParcelId, distanceM: number) {
      const seed = byId.get(parcelId);
      if (!seed) return [];
      const out: Array<{ readonly parcel: Parcel; readonly distanceM: number }> = [];
      for (const e of enriched) {
        if (e.parcel.parcelId === parcelId) continue;
        const d = haversineDistanceM(seed.centroid, e.centroid);
        if (d <= distanceM) {
          out.push({ parcel: e.parcel, distanceM: d });
        }
      }
      out.sort((a, b) => a.distanceM - b.distanceM);
      return out;
    },
  });
}
