/**
 * @borjie/geo-intelligence — root barrel.
 *
 * Field-driven geo-intelligence engine. Composes the polygon editor,
 * 6-layer metadata store, segmentation + heatmap, association graph,
 * event-sourced history, spatial queries, field capture pipeline,
 * imagery adapters, and per-jurisdiction compliance overlays into a
 * single orchestrator.
 *
 * Spec: Docs/requirements/VOICE_MEMO_2026-04-18_questionnaire_analysis.md §2-§3.
 */

export * from './types.js';

// Geometry kernel
export {
  polygonBoundingBox,
  polygonAreaSqm,
  polygonCentroid,
  isPolygonSelfIntersecting,
  pointInPolygon,
  wgs84ToWebMercator,
  webMercatorToWgs84,
  closeRing,
  rectanglePolygon,
  circlePolygon,
  hexagonPolygon,
  regularNgonPolygon,
  createPolygonEditor,
  punchHole,
  splitPolygon,
  mergePolygons,
  mergeIntoMultiPolygon,
  type PolygonEditor,
  type EditorState,
  type SplitResult,
} from './geometry/index.js';

// Metadata
export {
  legalLayerSchema,
  physicalLayerSchema,
  financialLayerSchema,
  environmentalLayerSchema,
  socialLayerSchema,
  infrastructureLayerSchema,
  customLayerSchema,
  layerSchemaByKind,
  createInMemoryLayerStore,
  type LegalLayer,
  type PhysicalLayer,
  type FinancialLayer,
  type EnvironmentalLayer,
  type SocialLayer,
  type InfrastructureLayer,
  type LayerStore,
  type StandardLayerKind,
} from './metadata/index.js';

// Segmentation
export {
  sampleScale,
  sampleCategorical,
  normalizeToScale,
  createSegmentationView,
  buildHeatmap,
  buildClusters,
  type CreateSegmentationViewArgs,
  type HeatmapCell,
  type ClusterPoint,
  type ClusterArgs,
} from './segmentation/index.js';

// Associations
export { createParcelGraph, type ParcelGraph } from './associations/index.js';

// History
export {
  createInMemoryEventStore,
  defaultReducer,
  emptyParcelSnapshot,
  type EventStore,
  type HistoryFilter,
  type ParcelSnapshot,
} from './history/index.js';

// Queries
export { createSpatialIndex, type SpatialIndex } from './queries/index.js';

// Capture
export {
  parseExifGps,
  hashCapturePayload,
  signCapture,
  verifyCapture,
  createInMemoryCaptureStore,
  createCapturePipeline,
  defaultAiInference,
  type C2paSignaturePayload,
  type CaptureStore,
  type CapturePipelineDeps,
  type SubmitFieldCaptureArgs,
  type FieldCaptureInput,
  type AiInferenceFn,
} from './capture/index.js';

// Imagery
export {
  createSentinel2Provider,
  createMapboxSatelliteProvider,
  createMapillaryProvider,
  createGenericDroneFeedProvider,
  createPlanetMonthlyProvider,
  type SatelliteProvider,
  type StreetViewProvider,
  type DroneFeedProvider,
} from './imagery/index.js';

// Compliance
export {
  createComplianceEngine,
  tz,
  ke,
  ug,
  rw,
  type ComplianceEngine,
} from './compliance/index.js';

// Orchestrator
export {
  createGeoIntelligence,
  type GeoIntelligence,
  type GeoIntelligenceDeps,
  type ImageryDeps,
} from './orchestrator.js';
