/**
 * Segmentation view builder + heatmap + cluster aggregator.
 */

import type {
  ColorScaleId,
  GeoJsonPoint,
  Parcel,
  ParcelId,
  SegmentationDimension,
  SegmentationView,
} from '../types.js';
import { normalizeToScale, sampleCategorical, sampleScale } from './color-scales.js';

export interface CreateSegmentationViewArgs {
  readonly parcels: ReadonlyArray<Parcel>;
  readonly dimension: SegmentationDimension;
  readonly colorScale: ColorScaleId;
  /** Resolves the numeric / categorical value for each parcel. */
  readonly valueResolver: (parcel: Parcel) => number | string;
}

/**
 * Build a colored view across parcels along a single dimension.
 *
 * - Numeric values are normalised to [0,1] across the input and
 *   sampled from the chosen continuous scale.
 * - Categorical (string) values are hashed to a categorical-12 index.
 */
export function createSegmentationView(
  args: CreateSegmentationViewArgs,
): ReadonlyArray<SegmentationView> {
  if (args.parcels.length === 0) return [];

  const resolved = args.parcels.map((p) => ({
    parcel: p,
    value: args.valueResolver(p),
  }));

  const numeric = resolved.every((r) => typeof r.value === 'number');
  if (numeric) {
    const numbers = resolved.map((r) => r.value as number);
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    return resolved.map((r) => {
      const v = r.value as number;
      const t = normalizeToScale(v, min, max);
      return Object.freeze({
        parcelId: r.parcel.parcelId,
        color: sampleScale(args.colorScale, t),
        label: `${args.dimension}: ${v}`,
        value: v,
      });
    });
  }

  // Categorical path — stable index per unique value, use sampleCategorical
  // regardless of args.colorScale to keep category mapping deterministic.
  const indexByValue = new Map<string, number>();
  for (const r of resolved) {
    const v = String(r.value);
    if (!indexByValue.has(v)) {
      indexByValue.set(v, indexByValue.size);
    }
  }
  return resolved.map((r) => {
    const v = String(r.value);
    const idx = indexByValue.get(v) ?? 0;
    return Object.freeze({
      parcelId: r.parcel.parcelId,
      color: sampleCategorical(idx),
      label: `${args.dimension}: ${v}`,
      value: v,
    });
  });
}

// ============================================================================
// Heatmap — continuous values -> color gradient + opacity
// ============================================================================

export interface HeatmapCell {
  readonly parcelId: ParcelId;
  readonly color: string;
  readonly opacity: number;
  readonly value: number;
}

export function buildHeatmap(args: {
  readonly parcels: ReadonlyArray<{ readonly parcelId: ParcelId; readonly value: number }>;
  readonly colorScale: ColorScaleId;
  readonly minOpacity?: number;
  readonly maxOpacity?: number;
}): ReadonlyArray<HeatmapCell> {
  if (args.parcels.length === 0) return [];
  const values = args.parcels.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const minOp = args.minOpacity ?? 0.2;
  const maxOp = args.maxOpacity ?? 0.9;
  return args.parcels.map((p) => {
    const t = normalizeToScale(p.value, min, max);
    return Object.freeze({
      parcelId: p.parcelId,
      color: sampleScale(args.colorScale, t),
      opacity: minOp + t * (maxOp - minOp),
      value: p.value,
    });
  });
}

// ============================================================================
// Cluster aggregator — group nearby parcels at low zoom
// ============================================================================

export interface ClusterPoint {
  readonly id: string;
  readonly centroid: GeoJsonPoint;
  readonly count: number;
  readonly parcelIds: ReadonlyArray<ParcelId>;
  readonly summary: {
    readonly totalAreaSqm: number;
    readonly averageAreaSqm: number;
  };
}

export interface ClusterArgs {
  readonly parcels: ReadonlyArray<Parcel>;
  /** Cell size in degrees (lat & lng). e.g. 0.01 ~ 1 km at equator. */
  readonly cellDeg: number;
}

export function buildClusters(args: ClusterArgs): ReadonlyArray<ClusterPoint> {
  const buckets = new Map<string, Parcel[]>();
  for (const p of args.parcels) {
    const lon = p.centroid.coordinates[0];
    const lat = p.centroid.coordinates[1];
    const cx = Math.floor(lon / args.cellDeg);
    const cy = Math.floor(lat / args.cellDeg);
    const key = `${cx}:${cy}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(p);
  }
  const out: ClusterPoint[] = [];
  for (const [key, list] of buckets) {
    const sumLon = list.reduce((acc, p) => acc + p.centroid.coordinates[0], 0);
    const sumLat = list.reduce((acc, p) => acc + p.centroid.coordinates[1], 0);
    const totalArea = list.reduce((acc, p) => acc + p.areaSqm, 0);
    const cluster: ClusterPoint = {
      id: `cluster_${key}`,
      centroid: {
        type: 'Point' as const,
        coordinates: [sumLon / list.length, sumLat / list.length] as const,
      },
      count: list.length,
      parcelIds: list.map((p) => p.parcelId),
      summary: {
        totalAreaSqm: totalArea,
        averageAreaSqm: totalArea / list.length,
      },
    };
    out.push(Object.freeze(cluster));
  }
  return out;
}
