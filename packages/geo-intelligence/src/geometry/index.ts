/**
 * Geometry barrel.
 */

export {
  polygonBoundingBox,
  polygonAreaSqm,
  polygonCentroid,
  isPolygonSelfIntersecting,
  pointInPolygon,
  wgs84ToWebMercator,
  webMercatorToWgs84,
  closeRing,
} from './polygon-ops.js';

export {
  rectanglePolygon,
  circlePolygon,
  hexagonPolygon,
  regularNgonPolygon,
} from './regular-shapes.js';

export {
  createPolygonEditor,
  punchHole,
  splitPolygon,
  mergePolygons,
  mergeIntoMultiPolygon,
  type PolygonEditor,
  type EditorState,
  type SplitResult,
} from './polygon-editor.js';
