/**
 * @borjie/genui — shared AG-UI generative-UI renderer.
 *
 * 10 typed primitives + the `AdaptiveRenderer` dispatcher consumed by
 * every BORJIE portal (admin-web, owner-portal,
 * customer-app, estate-manager-app) so all four surfaces render the
 * same typed `AgUiUiPart` payloads emitted by the kernel's render-block
 * tools.
 *
 * Consumers (e.g. `JarvisConsole`) import only `AdaptiveRenderer` and
 * `AgUiUiPart`. The individual primitives are exported for tests +
 * future code-splitting.
 */

export { AdaptiveRenderer } from './AdaptiveRenderer';
export type {
  AdaptiveRendererProps,
  AdaptiveRendererSingleProps,
  AdaptiveRendererListProps,
  GenUiUnknownKindEventDetail,
} from './AdaptiveRenderer';

export { GENUI_REGISTRY, GENUI_KINDS } from './registry';

export { VegaChart, type VegaChartProps } from './components/VegaChart';
export { DataTable, type DataTableProps } from './components/DataTable';
export { Timeline, type TimelineProps } from './components/Timeline';
export { KpiGrid, type KpiGridProps } from './components/KpiGrid';
export { PrefillForm, type PrefillFormProps } from './components/PrefillForm';
export { ApprovalDialog, type ApprovalDialogProps } from './components/ApprovalDialog';
export { WorkflowStepper, type WorkflowStepperProps } from './components/WorkflowStepper';
export { MapView, type MapViewProps } from './components/MapView';
export { CalendarView, type CalendarViewProps } from './components/CalendarView';
export { FilePreview, type FilePreviewProps } from './components/FilePreview';
export { UnknownKindCard } from './components/UnknownKindCard';
export type { FrameProps } from './components/Frame';
// ProdFix-7 Tier-1
export { Kanban, type KanbanProps } from './components/Kanban';
export { DashboardGrid, type DashboardGridProps } from './components/DashboardGrid';
export { Heatmap, type HeatmapProps } from './components/Heatmap';
export { MarkdownCard, type MarkdownCardProps } from './components/MarkdownCard';
export { PromptSuggestions, type PromptSuggestionsProps } from './components/PromptSuggestions';
export { EvidenceCard, type EvidenceCardProps } from './components/EvidenceCard';
// ProdFix-7 Tier-2
export { Tree, type TreeProps } from './components/Tree';
export { DiffView, type DiffViewProps } from './components/DiffView';
export { Gauge, type GaugeProps } from './components/Gauge';
export { MetricSparkline, type MetricSparklineProps } from './components/MetricSparkline';
export { ImageAnnotation, type ImageAnnotationProps } from './components/ImageAnnotation';
export { SignaturePad, type SignaturePadProps } from './components/SignaturePad';
// Phase E.7 — 13 new primitives (landed in ProdFix-8)
export { PdfViewer, type PdfViewerProps } from './components/PdfViewer';
export { SliderInput, type SliderInputProps } from './components/SliderInput';
export { MultistepWizard, type MultistepWizardProps } from './components/MultistepWizard';
export { MediaGrid, type MediaGridProps } from './components/MediaGrid';
export { ChatEmbed, type ChatEmbedProps } from './components/ChatEmbed';
export { LiveCounter, type LiveCounterProps } from './components/LiveCounter';
export { OrgChart, type OrgChartProps } from './components/OrgChart';
export { ComparisonTable, type ComparisonTableProps } from './components/ComparisonTable';
export { GeoFence, type GeoFenceProps } from './components/GeoFence';
export { NotificationToast, type NotificationToastProps } from './components/NotificationToast';
export { DecisionTrace, type DecisionTraceProps } from './components/DecisionTrace';
export { CodeBlock, type CodeBlockProps } from './components/CodeBlock';
export { DataflowDiagram, type DataflowDiagramProps } from './components/DataflowDiagram';

// Issue #37 — richer gantt renderer (standalone, not part of AgUiUiPart).
export {
  GanttChart,
  GanttBarSchema,
  GanttChartSchema,
  type GanttChartProps,
  type GanttBar,
  type GanttBarStatus,
} from './components/GanttChart';

export { Frame, GenUiError } from './components/Frame';
export { ClientOnly } from './components/ClientOnly';

export type {
  AgUiUiPart,
  AgUiUiPartByKind,
  VegaLiteSpec,
  DataTableColumn,
  TimelineEvent,
  KpiTile,
  WorkflowStep,
  MapMarker,
  CalendarEvent,
  // ProdFix-7 sub-types
  KanbanCard,
  KanbanColumn,
  MarkdownCitation,
  PromptSuggestion,
  TreeAction,
  TreeNode,
  ImageAnnotation as ImageAnnotationType,
  GaugeThreshold,
  SignatureAction,
  // Phase E.7 sub-types
  WizardStep,
  MediaGridItem,
  OrgChartNode,
  ComparisonRow,
  GeoFencePoint,
  DataflowNode,
  DataflowEdge,
  DecisionTraceStep,
  Iso4217,
} from './types';

export {
  ChartVegaPartSchema,
  DataTablePartSchema,
  TimelinePartSchema,
  KpiGridPartSchema,
  PrefillFormPartSchema,
  PrefillFormActionSchema,
  ApprovalPartSchema,
  WorkflowPartSchema,
  MapPartSchema,
  CalendarPartSchema,
  FilePreviewPartSchema,
  // ProdFix-7 schemas
  KanbanPartSchema,
  KanbanCardSchema,
  KanbanColumnSchema,
  DashboardGridPartSchema,
  DashboardGridCellSchema,
  HeatmapPartSchema,
  MarkdownCardPartSchema,
  MarkdownCitationSchema,
  PromptSuggestionsPartSchema,
  PromptSuggestionSchema,
  EvidenceCardPartSchema,
  TreePartSchema,
  TreeNodeSchema,
  DiffViewPartSchema,
  GaugePartSchema,
  MetricSparklinePartSchema,
  ImageAnnotationPartSchema,
  ImageAnnotationSchema,
  SignaturePadPartSchema,
  // Phase E.7 schemas
  PdfViewerPartSchema,
  SliderInputPartSchema,
  MultistepWizardPartSchema,
  WizardStepSchema,
  WizardFieldSchema,
  MediaGridPartSchema,
  MediaGridItemSchema,
  ChatEmbedPartSchema,
  ChatEmbedMessageSchema,
  LiveCounterPartSchema,
  OrgChartPartSchema,
  OrgChartNodeSchema,
  ComparisonTablePartSchema,
  ComparisonRowSchema,
  GeoFencePartSchema,
  GeoFencePointSchema,
  NotificationToastPartSchema,
  DecisionTracePartSchema,
  DecisionTraceStepSchema,
  CodeBlockPartSchema,
  DataflowDiagramPartSchema,
  DataflowNodeSchema,
  DataflowEdgeSchema,
  PART_SCHEMAS,
  type PartKind,
} from './schemas';

export {
  validateVegaSpec,
  quickVegaShapeCheck,
  stripVegaExpressions,
  VEGA_EXPRESSION_KEYS,
} from './validate';

// H12 — host-action dispatcher contract (see genui-host-actions.ts JSDoc).
export {
  createGenUiActionDispatcher,
  GENUI_ACTION_EVENTS,
} from './genui-host-actions';
export type {
  GenUiActionEventName,
  GenUiActionPayload,
  GenUiActionDispatcherOptions,
} from './genui-host-actions';
export {
  formatCurrency,
  formatPercent,
  formatNumber,
  formatDate,
  formatCell,
  type Currency,
} from './format';

// ─────────────────────────────────────────────────────────────────────
// PortalLayout — dynamic per-user UI document
// (`.audit/litfin-sota-2026-05-23/12-dynamic-per-user-ui.md`)
// ─────────────────────────────────────────────────────────────────────
export {
  PortalLayoutSchema,
  PortalLayoutSeedSchema,
  PortalTopbarSchema,
  PortalSidebarSchema,
  PortalSidebarSectionSchema,
  PortalSidebarItemSchema,
  PortalDashboardSchema,
  PortalDashboardCellSchema,
  PortalPrimaryActionSchema,
  PortalThemeSchema,
  PortalFeatureFlagsSchema,
  PortalAccessibilityProfileSchema,
  PortalLayoutAuditSchema,
  PortalPersonaSchema,
  PortalPrimaryIntentSchema,
  PortalDashboardKindSchema,
  PORTAL_PERSONAS,
  PORTAL_PRIMARY_INTENTS,
  PORTAL_DASHBOARD_KINDS,
  PORTAL_THEME_TOKEN_KEYS,
  PORTAL_LAYOUT_SCHEMA_VERSION,
  forkSeedIntoLayout,
  parsePortalLayout,
  safeParsePortalLayout,
  type PortalLayout,
  type PortalLayoutSeed,
  type PortalTopbar,
  type PortalSidebar,
  type PortalDashboard,
  type PortalPrimaryAction,
  type PortalTheme,
  type PortalFeatureFlags,
  type PortalAccessibilityProfile,
  type PortalLayoutAudit,
  type PortalPersona,
  type PortalPrimaryIntent,
  type PortalDashboardKind,
  type PortalThemeTokenKey,
  type ForkSeedInput,
} from './document';

export {
  PORTAL_LAYOUT_SEEDS,
  PORTAL_LAYOUT_DEFAULT_SEED,
  getPortalLayoutSeed,
} from './seeds';

// Piece-G — inline UI artifact catalog + renderer.
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

export {
  UiArtifact,
  validateAndRender,
  type UiArtifactProps,
  type UiArtifactRow,
  type ArtifactValidationFailure,
  type ValidateAndRenderResult,
} from './UiArtifact';

export { projectArtifactToUiPart } from './projector';
