/**
 * AG-UI generative-UI renderer for Borjie.
 *
 * Provenance: forward-ported into the `@borjie/genui` lineage; the
 * Borjie copy lives at `src/features/generative-ui/ag-ui` and has no
 * runtime dependency on any upstream package.
 *
 * 42 typed primitives + the `AdaptiveRenderer` dispatcher. The
 * `AgUiUiPart`-flavour shapes COEXIST with Borjie's existing
 * `GenerativeUiSpec` taxonomy under `src/core/brain/generative-ui/`;
 * both can be rendered side-by-side. Newer tools should emit
 * `AgUiUiPart` payloads; older callers continue to work unchanged.
 *
 * Consumers import only `AdaptiveRenderer` and
 * `AgUiUiPart`. The individual primitives are exported for tests +
 * future code-splitting.
 */

export { AdaptiveRenderer } from "./AdaptiveRenderer";
export type {
  AdaptiveRendererProps,
  AdaptiveRendererSingleProps,
  AdaptiveRendererListProps,
} from "./AdaptiveRenderer";

export { GENUI_REGISTRY, GENUI_KINDS, lookupAgUiComponent } from "./registry";

// iter-50-final wave-c wire — chat-artifact adapter (validate + flag).
export {
  isAgUiRegistryEnabled,
  tryComposeAgUiPart,
  composeAgUiPartOrThrow,
  type AgUiValidationResult,
} from "./chat-artifact-adapter";

export { VegaChart, type VegaChartProps } from "./components/VegaChart";
export { DataTable, type DataTableProps } from "./components/DataTable";
export { Timeline, type TimelineProps } from "./components/Timeline";
export { KpiGrid, type KpiGridProps } from "./components/KpiGrid";
export { PrefillForm, type PrefillFormProps } from "./components/PrefillForm";
export {
  ApprovalDialog,
  type ApprovalDialogProps,
} from "./components/ApprovalDialog";
export {
  WorkflowStepper,
  type WorkflowStepperProps,
} from "./components/WorkflowStepper";
export { MapView, type MapViewProps } from "./components/MapView";
export {
  CalendarView,
  type CalendarViewProps,
} from "./components/CalendarView";
export { FilePreview, type FilePreviewProps } from "./components/FilePreview";
export { UnknownKindCard } from "./components/UnknownKindCard";
export type { FrameProps } from "./components/Frame";
// ProdFix-7 Tier-1
export { Kanban, type KanbanProps } from "./components/Kanban";
export {
  DashboardGrid,
  type DashboardGridProps,
} from "./components/DashboardGrid";
export { Heatmap, type HeatmapProps } from "./components/Heatmap";
export {
  MarkdownCard,
  type MarkdownCardProps,
} from "./components/MarkdownCard";
export {
  PromptSuggestions,
  type PromptSuggestionsProps,
} from "./components/PromptSuggestions";
export {
  EvidenceCard,
  type EvidenceCardProps,
} from "./components/EvidenceCard";
// ProdFix-7 Tier-2
export { Tree, type TreeProps } from "./components/Tree";
export { DiffView, type DiffViewProps } from "./components/DiffView";
export { Gauge, type GaugeProps } from "./components/Gauge";
export {
  MetricSparkline,
  type MetricSparklineProps,
} from "./components/MetricSparkline";
export {
  ImageAnnotation,
  type ImageAnnotationProps,
} from "./components/ImageAnnotation";
export {
  SignaturePad,
  type SignaturePadProps,
} from "./components/SignaturePad";
// Phase E.7 — 13 new primitives (ProdFix-8, shipped).
export { PdfViewer, type PdfViewerProps } from "./components/PdfViewer";
export { SliderInput, type SliderInputProps } from "./components/SliderInput";
export {
  MultistepWizard,
  type MultistepWizardProps,
} from "./components/MultistepWizard";
export { MediaGrid, type MediaGridProps } from "./components/MediaGrid";
export { ChatEmbed, type ChatEmbedProps } from "./components/ChatEmbed";
export { LiveCounter, type LiveCounterProps } from "./components/LiveCounter";
export { OrgChart, type OrgChartProps } from "./components/OrgChart";
export {
  ComparisonTable,
  type ComparisonTableProps,
} from "./components/ComparisonTable";
export { GeoFence, type GeoFenceProps } from "./components/GeoFence";
export {
  NotificationToast,
  type NotificationToastProps,
} from "./components/NotificationToast";
export {
  DecisionTrace,
  type DecisionTraceProps,
} from "./components/DecisionTrace";
export { CodeBlock, type CodeBlockProps } from "./components/CodeBlock";
export {
  DataflowDiagram,
  type DataflowDiagramProps,
} from "./components/DataflowDiagram";

export { Frame, GenUiError } from "./components/Frame";
export { ClientOnly } from "./components/ClientOnly";

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
} from "./types";

export {
  ChartVegaPartSchema,
  DataTablePartSchema,
  TimelinePartSchema,
  KpiGridPartSchema,
  PrefillFormPartSchema,
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
} from "./schemas";

export { validateVegaSpec, quickVegaShapeCheck } from "./validate";
export {
  formatCurrency,
  formatPercent,
  formatNumber,
  formatDate,
  formatCell,
  type Currency,
} from "./format";
