/**
 * Regular-shape constructors — rectangle, circle, hexagon, custom n-gon.
 *
 * All shapes are produced as GeoJSON polygons in WGS84 (RFC 7946). The
 * "circle" is sampled as a high-resolution polygon for downstream
 * convenience; for true geodesic circles use the segmentation engine.
 */

import type { GeoJsonPolygon, GeoJsonPoint, Position } from '../types.js';
import { closeRing } from './polygon-ops.js';

const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function destinationPoint(
  center: GeoJsonPoint,
  bearingRad: number,
  distanceM: number,
): Position {
  const lat1 = center.coordinates[1] * DEG_TO_RAD;
  const lon1 = center.coordinates[0] * DEG_TO_RAD;
  const angularDist = distanceM / EARTH_RADIUS_M;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDist) +
      Math.cos(lat1) * Math.sin(angularDist) * Math.cos(bearingRad),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(lat1),
      Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [lon2 * RAD_TO_DEG, lat2 * RAD_TO_DEG];
}

export function rectanglePolygon(
  center: GeoJsonPoint,
  widthM: number,
  heightM: number,
  rotationDeg = 0,
): GeoJsonPolygon {
  const halfW = widthM / 2;
  const halfH = heightM / 2;
  const r = rotationDeg * DEG_TO_RAD;
  const points: ReadonlyArray<readonly [number, number]> = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];
  const ring: Position[] = points.map(([dx, dy]) => {
    const x = dx * Math.cos(r) - dy * Math.sin(r);
    const y = dx * Math.sin(r) + dy * Math.cos(r);
    const distance = Math.hypot(x, y);
    const bearing = Math.atan2(x, y); // 0 = north
    return destinationPoint(center, bearing, distance);
  });
  return {
    type: 'Polygon',
    coordinates: [closeRing(ring) as ReadonlyArray<Position>],
  };
}

export function circlePolygon(
  center: GeoJsonPoint,
  radiusM: number,
  segments = 64,
): GeoJsonPolygon {
  if (segments < 8) {
    throw new Error('circlePolygon: segments must be >= 8 to approximate a circle');
  }
  const ring: Position[] = [];
  for (let i = 0; i < segments; i++) {
    const bearing = (i / segments) * 2 * Math.PI;
    ring.push(destinationPoint(center, bearing, radiusM));
  }
  return {
    type: 'Polygon',
    coordinates: [closeRing(ring) as ReadonlyArray<Position>],
  };
}

export function hexagonPolygon(
  center: GeoJsonPoint,
  radiusM: number,
  flatTop = false,
): GeoJsonPolygon {
  const offsetRad = flatTop ? 0 : Math.PI / 6;
  const ring: Position[] = [];
  for (let i = 0; i < 6; i++) {
    const bearing = (i / 6) * 2 * Math.PI + offsetRad;
    ring.push(destinationPoint(center, bearing, radiusM));
  }
  return {
    type: 'Polygon',
    coordinates: [closeRing(ring) as ReadonlyArray<Position>],
  };
}

export function regularNgonPolygon(
  center: GeoJsonPoint,
  radiusM: number,
  sides: number,
): GeoJsonPolygon {
  if (sides < 3) {
    throw new Error('regularNgonPolygon: sides must be >= 3');
  }
  const ring: Position[] = [];
  for (let i = 0; i < sides; i++) {
    const bearing = (i / sides) * 2 * Math.PI;
    ring.push(destinationPoint(center, bearing, radiusM));
  }
  return {
    type: 'Polygon',
    coordinates: [closeRing(ring) as ReadonlyArray<Position>],
  };
}
