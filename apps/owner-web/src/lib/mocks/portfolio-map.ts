/**
 * Portfolio map mocks — GeoJSON layers for licences, sites,
 * settlements, water, protected areas and roads.
 *
 * Coordinates clustered around Geita (gold heartland) and Mbeya
 * (coltan) so the map zooms to a realistic Tanzanian extent on first
 * load. Used by the map screen as both real data and graceful-degrade
 * placeholder when Mapbox token is missing.
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

export const MAP_FEATURES: ReadonlyArray<MapFeature> = [
  {
    id: 'feat_pml_25434',
    kind: 'licence',
    name: 'PML 25434',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [32.218, -2.876],
          [32.224, -2.874],
          [32.227, -2.879],
          [32.221, -2.882],
          [32.218, -2.876],
        ],
      ],
    },
    properties: { mineral: 'gold', area_ha: 8.7 },
  },
  {
    id: 'feat_pml_28102',
    kind: 'licence',
    name: 'PML 28102',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [32.301, -2.811],
          [32.308, -2.810],
          [32.310, -2.816],
          [32.302, -2.818],
          [32.301, -2.811],
        ],
      ],
    },
    properties: { mineral: 'gold', area_ha: 6.2 },
  },
  {
    id: 'feat_site_nyakabale',
    kind: 'site',
    name: 'Nyakabale Reef Block',
    geometry: { type: 'Point', coordinates: [32.222, -2.878] },
    properties: { headcount: 32, mineral: 'gold' },
  },
  {
    id: 'feat_site_kakola',
    kind: 'site',
    name: 'Kakola Alluvial Terraces',
    geometry: { type: 'Point', coordinates: [32.305, -2.814] },
    properties: { headcount: 18, mineral: 'gold' },
  },
  {
    id: 'feat_site_mbeya',
    kind: 'site',
    name: 'Mbeya Ridge Pit 2',
    geometry: { type: 'Point', coordinates: [33.456, -8.911] },
    properties: { headcount: 11, mineral: 'coltan' },
  },
  {
    id: 'feat_settlement_nyaru',
    kind: 'settlement',
    name: 'Nyarugusu village',
    geometry: { type: 'Point', coordinates: [32.231, -2.870] },
    properties: { population: 4200 },
  },
  {
    id: 'feat_water_mbarika',
    kind: 'water',
    name: 'Mbarika stream',
    geometry: {
      type: 'LineString',
      coordinates: [
        [32.215, -2.872],
        [32.222, -2.881],
        [32.231, -2.888],
      ],
    },
    properties: { class: 'seasonal' },
  },
  {
    id: 'feat_protected_burigi',
    kind: 'protected',
    name: 'Burigi-Chato NP buffer',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [32.180, -2.850],
          [32.260, -2.840],
          [32.270, -2.910],
          [32.190, -2.920],
          [32.180, -2.850],
        ],
      ],
    },
    properties: { type: 'buffer_2km' },
  },
  {
    id: 'feat_road_geita',
    kind: 'road',
    name: 'Geita–Sengerema trunk',
    geometry: {
      type: 'LineString',
      coordinates: [
        [32.200, -2.870],
        [32.250, -2.872],
        [32.310, -2.880],
      ],
    },
    properties: { surface: 'tarmac' },
  },
];

export const MAP_INITIAL_VIEW = {
  longitude: 32.260,
  latitude: -2.880,
  zoom: 9.5,
};
