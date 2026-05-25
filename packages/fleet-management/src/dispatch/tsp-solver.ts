/**
 * Nearest-neighbour Travelling-Salesman heuristic + 2-opt refinement.
 *
 * For typical fleet dispatch sizes (≤30 stops) this returns a tour
 * within 5-15% of optimal in O(n²). For larger workloads we defer to
 * the Google Routes API (see `route-optimizer.ts`).
 *
 * Pure function — no I/O. Useful as the local fallback when the
 * Routes API is unavailable.
 */

import { type GeoPoint, type RouteStop, type Kilometres } from '../types.js';
import { haversineKm } from '../trips/geo.js';

/**
 * Build the n×n distance matrix in km.
 */
export function buildDistanceMatrix(points: ReadonlyArray<GeoPoint>): ReadonlyArray<ReadonlyArray<Kilometres>> {
  const n = points.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversineKm(points[i]!, points[j]!);
      matrix[i]![j] = d;
      matrix[j]![i] = d;
    }
  }
  return matrix;
}

function tourLength(matrix: ReadonlyArray<ReadonlyArray<number>>, order: ReadonlyArray<number>): number {
  let total = 0;
  for (let i = 1; i < order.length; i++) {
    total += matrix[order[i - 1]!]![order[i]!]!;
  }
  return total;
}

/**
 * Nearest-neighbour seed: start at 0, repeatedly jump to the closest
 * unvisited node. Worst case O(n²); fine for small dispatch sets.
 */
function nearestNeighbour(matrix: ReadonlyArray<ReadonlyArray<number>>): number[] {
  const n = matrix.length;
  if (n === 0) return [];
  const visited = new Array<boolean>(n).fill(false);
  const order: number[] = [0];
  visited[0] = true;
  for (let step = 1; step < n; step++) {
    const current = order[order.length - 1]!;
    let best = -1;
    let bestDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (visited[j]) continue;
      const d = matrix[current]![j]!;
      if (d < bestDist) {
        bestDist = d;
        best = j;
      }
    }
    if (best < 0) break;
    visited[best] = true;
    order.push(best);
  }
  return order;
}

/** 2-opt refinement — reverses sub-tours that cut total length. */
function twoOpt(matrix: ReadonlyArray<ReadonlyArray<number>>, order: ReadonlyArray<number>, maxIterations = 100): number[] {
  let improved = true;
  let current = [...order];
  let iter = 0;
  while (improved && iter < maxIterations) {
    improved = false;
    iter += 1;
    for (let i = 1; i < current.length - 2; i++) {
      for (let k = i + 1; k < current.length - 1; k++) {
        const a = current[i - 1]!;
        const b = current[i]!;
        const c = current[k]!;
        const d = current[k + 1]!;
        const before = matrix[a]![b]! + matrix[c]![d]!;
        const after = matrix[a]![c]! + matrix[b]![d]!;
        if (after + 1e-9 < before) {
          const reversed = current.slice(i, k + 1).reverse();
          current = [...current.slice(0, i), ...reversed, ...current.slice(k + 1)];
          improved = true;
        }
      }
    }
  }
  return current;
}

export interface TspResult {
  readonly orderedIndexes: ReadonlyArray<number>;
  readonly totalDistanceKm: Kilometres;
}

export function solveTsp(
  start: GeoPoint,
  stops: ReadonlyArray<RouteStop>,
  returnToStart = false,
): TspResult {
  const points = returnToStart
    ? [start, ...stops.map((s) => s.location), start]
    : [start, ...stops.map((s) => s.location)];
  const matrix = buildDistanceMatrix(points);
  let order = nearestNeighbour(matrix);
  // Pin the final index when returnToStart=true (it must remain at the depot)
  if (returnToStart) {
    const middle = order.filter((idx) => idx !== 0 && idx !== points.length - 1);
    const refined = twoOpt(matrix, [0, ...middle, points.length - 1]);
    return {
      orderedIndexes: refined,
      totalDistanceKm: tourLength(matrix, refined),
    };
  }
  order = twoOpt(matrix, order);
  return {
    orderedIndexes: order,
    totalDistanceKm: tourLength(matrix, order),
  };
}
