/**
 * Generative-UI primitive registry.
 *
 * `kind → React component`. AdaptiveRenderer uses this map to dispatch
 * `AgUiUiPart` payloads to the correct primitive without a large
 * switch statement (the switch lives in AdaptiveRenderer.tsx, but
 * tests use this registry to assert every kind is wired).
 *
 * Adding a new primitive:
 *   1. Add the schema in `./schemas/index.ts`
 *   2. Add the component file under `./components/`
 *   3. Register it here AND in AdaptiveRenderer.tsx
 *   4. Add a server-side render-block tool in
 *      `packages/central-intelligence/.../render-blocks/`
 */

import type { ComponentType } from "react";

import type { AgUiUiPart } from "./types";
import { VegaChart } from "./components/VegaChart";
import { DataTable } from "./components/DataTable";
import { Timeline } from "./components/Timeline";
import { KpiGrid } from "./components/KpiGrid";
import { PrefillForm } from "./components/PrefillForm";
import { ApprovalDialog } from "./components/ApprovalDialog";
import { WorkflowStepper } from "./components/WorkflowStepper";
import { MapView } from "./components/MapView";
import { CalendarView } from "./components/CalendarView";
import { FilePreview } from "./components/FilePreview";
// ProdFix-7
import { Kanban } from "./components/Kanban";
import { DashboardGrid } from "./components/DashboardGrid";
import { Heatmap } from "./components/Heatmap";
import { MarkdownCard } from "./components/MarkdownCard";
import { PromptSuggestions } from "./components/PromptSuggestions";
import { EvidenceCard } from "./components/EvidenceCard";
import { Tree } from "./components/Tree";
import { DiffView } from "./components/DiffView";
import { Gauge } from "./components/Gauge";
import { MetricSparkline } from "./components/MetricSparkline";
import { ImageAnnotation } from "./components/ImageAnnotation";
import { SignaturePad } from "./components/SignaturePad";
// Phase E.7 — 13 new primitives
import { PdfViewer } from "./components/PdfViewer";
import { SliderInput } from "./components/SliderInput";
import { MultistepWizard } from "./components/MultistepWizard";
import { MediaGrid } from "./components/MediaGrid";
import { ChatEmbed } from "./components/ChatEmbed";
import { LiveCounter } from "./components/LiveCounter";
import { OrgChart } from "./components/OrgChart";
import { ComparisonTable } from "./components/ComparisonTable";
import { GeoFence } from "./components/GeoFence";
import { NotificationToast } from "./components/NotificationToast";
import { DecisionTrace } from "./components/DecisionTrace";
import { CodeBlock } from "./components/CodeBlock";
import { DataflowDiagram } from "./components/DataflowDiagram";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
export const GENUI_REGISTRY: Record<AgUiUiPart["kind"], ComponentType<any>> = {
  "chart-vega": VegaChart,
  "data-table": DataTable,
  timeline: Timeline,
  "kpi-grid": KpiGrid,
  "prefill-form": PrefillForm,
  approval: ApprovalDialog,
  workflow: WorkflowStepper,
  map: MapView,
  calendar: CalendarView,
  "file-preview": FilePreview,
  // ProdFix-7 Tier-1
  kanban: Kanban,
  "dashboard-grid": DashboardGrid,
  heatmap: Heatmap,
  "markdown-card": MarkdownCard,
  "prompt-suggestions": PromptSuggestions,
  "evidence-card": EvidenceCard,
  // ProdFix-7 Tier-2
  tree: Tree,
  "diff-view": DiffView,
  gauge: Gauge,
  "metric-sparkline": MetricSparkline,
  "image-annotation": ImageAnnotation,
  "signature-pad": SignaturePad,
  // Phase E.7 — 13 new primitives
  "pdf-viewer": PdfViewer,
  "slider-input": SliderInput,
  "multistep-wizard": MultistepWizard,
  "media-grid": MediaGrid,
  "chat-embed": ChatEmbed,
  "live-counter": LiveCounter,
  "org-chart": OrgChart,
  "comparison-table": ComparisonTable,
  "geo-fence": GeoFence,
  "notification-toast": NotificationToast,
  "decision-trace": DecisionTrace,
  "code-block": CodeBlock,
  "dataflow-diagram": DataflowDiagram,
};

export const GENUI_KINDS = Object.keys(GENUI_REGISTRY) as ReadonlyArray<
  AgUiUiPart["kind"]
>;

/**
 * iter-50-final wave-c wire — typed lookup for the chat-artifact bridge.
 *
 * Returns the registered React component for `kind`, or `null` when the
 * client build does not yet ship that primitive. Callers fall back to
 * the legacy AdaptiveRenderer (the existing chat-artifact composer) on
 * `null` so the chat surface never blanks on an unknown kind.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
export function lookupAgUiComponent(kind: string): ComponentType<any> | null {
  if (!kind || typeof kind !== "string") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
  const map = GENUI_REGISTRY as Record<string, ComponentType<any>>;
  return Object.prototype.hasOwnProperty.call(map, kind) ? map[kind] : null;
}
