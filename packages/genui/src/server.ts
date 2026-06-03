/**
 * Server-only entry point.
 *
 * Re-exports the schema + catalog + projector pieces of `@borjie/genui`
 * that the api-gateway needs, WITHOUT pulling React or any DOM-only
 * primitive (Leaflet, react-vega, react-pdf, etc.). Importing from this
 * subpath keeps the SSR pipeline and node-side persistence safe to
 * bundle.
 *
 * Stable public API (consumers must use these named imports):
 *   - ARTIFACT_CATALOG, ARTIFACT_CATALOG_BY_KEY, ARTIFACT_COMPONENT_TYPES
 *   - listArtifactTypes, ArtifactComponentType, ArtifactCatalogEntry,
 *     ArtifactCatalogSummary
 *   - All catalog Zod schemas
 *   - UiArtifactRow (the only UiArtifact type that is pure — the React
 *     component is intentionally NOT exported from here)
 *   - validateAndRender (the function half of UiArtifact — pure)
 */

export {
  ARTIFACT_CATALOG,
  ARTIFACT_CATALOG_BY_KEY,
  ARTIFACT_COMPONENT_TYPES,
  listArtifactTypes,
  type ArtifactComponentType,
  type ArtifactCatalogEntry,
  type ArtifactCatalogSummary,
  KpiTileArtifactSchema,
  BarChartArtifactSchema,
  LineChartArtifactSchema,
  PieChartArtifactSchema,
  DataTableArtifactSchema,
  FormArtifactSchema,
  DeckSlideArtifactSchema,
  DocSectionArtifactSchema,
  MapViewArtifactSchema,
  HeatmapArtifactSchema,
  TimelineArtifactSchema,
  KanbanArtifactSchema,
  GanttArtifactSchema,
  FunnelArtifactSchema,
  MetricGridArtifactSchema,
  ImageArtifactSchema,
  VideoArtifactSchema,
  CodeBlockArtifactSchema,
  MarkdownArtifactSchema,
  CalloutArtifactSchema,
  ComparisonArtifactSchema,
  PivotTableArtifactSchema,
  SparklineArtifactSchema,
  TreemapArtifactSchema,
  SankeyArtifactSchema,
  ScatterArtifactSchema,
  GaugeArtifactSchema,
  RadarArtifactSchema,
  BoxPlotArtifactSchema,
  HistogramArtifactSchema,
  OrgChartArtifactSchema,
  WorkflowArtifactSchema,
} from './catalog';

export { projectArtifactToUiPart } from './projector';
export {
  validateAndRender,
  type UiArtifactRow,
  type ArtifactValidationFailure,
  type ValidateAndRenderResult,
} from './validate-artifact';
export { PART_SCHEMAS, type PartKind } from './schemas';
export type { AgUiUiPart } from './types';

// LP-24b: framework-free streaming-artifact contract (stream parser,
// typed StreamingArtifact<T> writer/reducer, choreography state machine).
// Pure + dependency-free, so it is safe on this node-side entry and is
// also re-exported from the React index for client hooks.
export {
  createChatArtifactStreamParser,
  createArtifactWriter,
  createInMemoryArtifactTransport,
  reduceArtifactChunk,
  assembleArtifact,
  sortRevealsByTime,
  totalChoreographyMs,
  initChoreographyState,
  tickChoreography,
  applyInteraction,
  type ChatArtifactStreamParser,
  type ArtifactStreamEvent,
  type ArtifactStreamEventType,
  type ArtifactOpenEvent,
  type ArtifactDeltaEvent,
  type ArtifactCloseEvent,
  type ArtifactStreamSink,
  type ArtifactChunk,
  type ArtifactChunkKind,
  type ArtifactTransport,
  type ArtifactWriter,
  type ArtifactWriterClock,
  type StreamingArtifact,
  type StreamingArtifactStatus,
  type BlackboardChoreography,
  type RevealCue,
  type VoiceMarker,
  type StoryShape,
  type InteractionResponse,
  type ChoreographyState,
  type ChoreographyTickEvent,
} from './streaming/index';
