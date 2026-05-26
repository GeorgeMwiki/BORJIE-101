/**
 * Portfolio-map GeoJSON type shapes (O-W-05).
 */

export type FeatureKind =
  | 'licence'
  | 'site'
  | 'settlement'
  | 'water'
  | 'protected'
  | 'road';

export interface MapFeature {
  readonly id: string;
  readonly kind: FeatureKind;
  readonly name: string;
  readonly geometry: {
    readonly type: 'Polygon' | 'Point' | 'LineString';
    readonly coordinates: number[] | number[][] | number[][][];
  };
  readonly properties: Record<string, string | number>;
}

/**
 * Default map viewport — Geita gold heartland. Constant lives next to
 * the type because every consumer needs a sensible "no features" view.
 */
export const MAP_INITIAL_VIEW = {
  longitude: 32.260,
  latitude: -2.880,
  zoom: 9.5,
} as const;
