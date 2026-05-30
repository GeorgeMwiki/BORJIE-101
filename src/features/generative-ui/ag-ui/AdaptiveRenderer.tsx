"use client";

/**
 * AdaptiveRenderer — dispatches `AgUiUiPart` → primitive component.
 *
 * Anti-patterns enforced:
 *   - render only on COMPLETE `tool-output-available` payload — never
 *     streamed piece-by-piece
 *   - LLM never emits classnames or JSX; primitives own all rendering
 *   - unknown `kind` renders a graceful-degrade card, never crashes
 *
 * This switch is the contractual boundary between the brain's emit
 * vocabulary and the host portal's display layer. Adding a new
 * primitive requires touching this file + the registry.
 *
 * Two call shapes are supported so existing admin-platform-portal call
 * sites (single uiPart) keep working alongside the new owner-portal +
 * customer-app + estate-manager-app call sites (list of uiParts):
 *
 *   <AdaptiveRenderer uiPart={part} />          // single
 *   <AdaptiveRenderer parts={uiParts} />        // list
 */

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
import { UnknownKindCard } from "./components/UnknownKindCard";
// ProdFix-7 — 12 new primitives
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

export interface AdaptiveRendererSingleProps {
  readonly uiPart: AgUiUiPart;
  readonly parts?: undefined;
}

export interface AdaptiveRendererListProps {
  readonly parts: ReadonlyArray<AgUiUiPart>;
  readonly uiPart?: undefined;
}

export type AdaptiveRendererProps =
  | AdaptiveRendererSingleProps
  | AdaptiveRendererListProps;

function renderOne(uiPart: AgUiUiPart): JSX.Element {
  switch (uiPart.kind) {
    case "chart-vega":
      return <VegaChart {...uiPart} />;
    case "data-table":
      return <DataTable {...uiPart} />;
    case "timeline":
      return <Timeline {...uiPart} />;
    case "kpi-grid":
      return <KpiGrid {...uiPart} />;
    case "prefill-form":
      return <PrefillForm {...uiPart} />;
    case "approval":
      return <ApprovalDialog {...uiPart} />;
    case "workflow":
      return <WorkflowStepper {...uiPart} />;
    case "map":
      return <MapView {...uiPart} />;
    case "calendar":
      return <CalendarView {...uiPart} />;
    case "file-preview":
      return <FilePreview {...uiPart} />;
    // ── ProdFix-7 Tier-1 ──────────────────────────────────────────────
    case "kanban":
      return <Kanban {...uiPart} />;
    case "dashboard-grid":
      return <DashboardGrid {...uiPart} renderChild={renderOne} />;
    case "heatmap":
      return <Heatmap {...uiPart} />;
    case "markdown-card":
      return <MarkdownCard {...uiPart} />;
    case "prompt-suggestions":
      return <PromptSuggestions {...uiPart} />;
    case "evidence-card":
      return <EvidenceCard {...uiPart} />;
    // ── ProdFix-7 Tier-2 ──────────────────────────────────────────────
    case "tree":
      return <Tree {...uiPart} />;
    case "diff-view":
      return <DiffView {...uiPart} />;
    case "gauge":
      return <Gauge {...uiPart} />;
    case "metric-sparkline":
      return <MetricSparkline {...uiPart} />;
    case "image-annotation":
      return <ImageAnnotation {...uiPart} />;
    case "signature-pad":
      return <SignaturePad {...uiPart} />;
    // ── Phase E.7 ─────────────────────────────────────────────────────
    case "pdf-viewer":
      return <PdfViewer {...uiPart} />;
    case "slider-input":
      return <SliderInput {...uiPart} />;
    case "multistep-wizard":
      return <MultistepWizard {...uiPart} />;
    case "media-grid":
      return <MediaGrid {...uiPart} />;
    case "chat-embed":
      return <ChatEmbed {...uiPart} />;
    case "live-counter":
      return <LiveCounter {...uiPart} />;
    case "org-chart":
      return <OrgChart {...uiPart} />;
    case "comparison-table":
      return <ComparisonTable {...uiPart} />;
    case "geo-fence":
      return <GeoFence {...uiPart} />;
    case "notification-toast":
      return <NotificationToast {...uiPart} />;
    case "decision-trace":
      return <DecisionTrace {...uiPart} />;
    case "code-block":
      return <CodeBlock {...uiPart} />;
    case "dataflow-diagram":
      return <DataflowDiagram {...uiPart} />;
    default: {
      // Defensive: a future brain version might emit a kind this
      // client doesn't yet know. Renders an obvious unknown-kind card
      // so the user knows it's missing without crashing the console.
      const unknown = uiPart as { kind?: string };
      return (
        <UnknownKindCard kind={unknown.kind ?? "(missing)"} payload={uiPart} />
      );
    }
  }
}

export function AdaptiveRenderer(props: AdaptiveRendererProps): JSX.Element {
  if ("parts" in props && props.parts) {
    return (
      <div className="flex flex-col gap-2">
        {props.parts.map((p, i) => (
          <div key={i}>{renderOne(p)}</div>
        ))}
      </div>
    );
  }
  // Single-uiPart legacy shape.
  return renderOne(props.uiPart as AgUiUiPart);
}
