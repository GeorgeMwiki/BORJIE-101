/**
 * Client-side AG-UI UiPart types.
 *
 * Mirrors `packages/central-intelligence/src/kernel/tools/render-blocks/ag-ui-types.ts`
 * — kept local so the client doesn't pull the server kernel into its
 * bundle. The shapes MUST stay in lock-step. The shared Zod schemas
 * under `./schemas/` are the cross-boundary validator; this module
 * is types-only.
 *
 * When C1 lands `packages/central-intelligence/src/kernel/streaming/
 * ag-ui-types.ts`, replace this file with a re-export from there.
 */

export type VegaLiteSpec = Readonly<Record<string, unknown>>;

/**
 * Any ISO-4217 3-letter currency code (H13). The schema validates the
 * regex `^[A-Z]{3}$` at parse time; the types accept `string` so a
 * Nigerian NGN, Ugandan UGX, Rwandan RWF, Ghanaian GHS, etc. all flow
 * through without recompiling the genui package. Built for the world
 * starting with TZ — never hard-code jurisdiction in the type surface.
 */
export type Iso4217 = string;

export interface DataTableColumn {
  readonly id: string;
  readonly header: string;
  readonly accessorKey: string;
  readonly format?: 'text' | 'currency' | 'percent' | 'number' | 'date';
  readonly currency?: Iso4217;
  readonly enableSorting?: boolean;
}

export interface TimelineEvent {
  readonly timestamp: string;
  readonly title: string;
  readonly description?: string;
  readonly severity?: 'info' | 'warn' | 'error' | 'success';
  readonly icon?: string;
}

export interface KpiTile {
  readonly label: string;
  readonly value: number | string;
  readonly delta?: number;
  readonly deltaDirection?: 'up' | 'down' | 'flat';
  readonly format: 'currency' | 'percent' | 'number';
  readonly currency?: Iso4217;
}

export interface WorkflowStep {
  readonly label: string;
  readonly status: 'pending' | 'running' | 'done' | 'failed';
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface MapMarker {
  readonly position: readonly [number, number];
  readonly popup?: string;
}

export interface CalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly end?: string;
  readonly color?: string;
}

// ─────────────────────────────────────────────────────────────────────
// ProdFix-7 — 12 new kinds (Tier-1 + Tier-2)
// ─────────────────────────────────────────────────────────────────────

export interface KanbanCard {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly badges?: ReadonlyArray<string>;
  readonly meta?: Readonly<Record<string, string | number>>;
  readonly dueAt?: string;
}

export interface KanbanColumn {
  readonly id: string;
  readonly title: string;
  readonly cards: ReadonlyArray<KanbanCard>;
}

export interface MarkdownCitation {
  readonly id: string;
  readonly label: string;
  readonly sourceUri?: string;
  readonly sourceRowRef?: string;
}

export interface PromptSuggestion {
  readonly label: string;
  readonly prompt: string;
  readonly kind: 'primary' | 'secondary' | 'destructive';
  readonly icon?: string;
}

export interface TreeAction {
  readonly kind: 'message' | 'tool' | 'navigate';
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly badge?: string;
  readonly children?: ReadonlyArray<TreeNode>;
  readonly onClickAction?: TreeAction;
}

export interface ImageAnnotation {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly severity: 'info' | 'warning' | 'critical';
}

export interface GaugeThreshold {
  readonly value: number;
  readonly color: string;
}

export interface SignatureAction {
  readonly kind: 'tool' | 'navigate';
  readonly payload: Readonly<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────────────
// Phase E.7 — 13 new kinds (landed in ProdFix-8)
// ─────────────────────────────────────────────────────────────────────

export interface WizardStep {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly fields: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly type: 'text' | 'number' | 'select' | 'textarea' | 'checkbox';
    readonly options?: ReadonlyArray<{ readonly label: string; readonly value: string }>;
    readonly required?: boolean;
  }>;
}

export interface MediaGridItem {
  readonly id: string;
  readonly url: string;
  readonly thumbUrl?: string;
  readonly caption?: string;
  readonly takenAt?: string;
  readonly mimeType?: string;
}

export interface OrgChartNode {
  readonly id: string;
  readonly label: string;
  readonly role?: string;
  readonly badge?: string;
  readonly children?: ReadonlyArray<OrgChartNode>;
}

export interface ComparisonRow {
  readonly key: string;
  readonly label: string;
  readonly values: ReadonlyArray<string | number | null>;
  readonly format?: 'text' | 'currency' | 'percent' | 'number' | 'date';
  readonly currency?: string;
  readonly highlight?: 'best' | 'worst' | 'none';
}

export interface GeoFencePoint {
  readonly lat: number;
  readonly lng: number;
}

export interface DataflowNode {
  readonly id: string;
  readonly label: string;
  readonly kind: 'source' | 'transform' | 'sink' | 'decision';
  readonly status?: 'pending' | 'running' | 'done' | 'failed';
}

export interface DataflowEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export interface DecisionTraceStep {
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
  readonly kind: 'observation' | 'inference' | 'tool-call' | 'decision' | 'output';
  readonly evidence?: ReadonlyArray<{ readonly label: string; readonly uri?: string }>;
  readonly confidence?: 'high' | 'medium' | 'low';
}

export type AgUiUiPart =
  | {
      readonly kind: 'chart-vega';
      readonly title?: string;
      readonly spec: VegaLiteSpec;
      readonly data: ReadonlyArray<Readonly<Record<string, unknown>>>;
    }
  | {
      readonly kind: 'data-table';
      readonly title?: string;
      readonly columns: ReadonlyArray<DataTableColumn>;
      readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
      readonly pageSize?: number;
    }
  | {
      readonly kind: 'timeline';
      readonly title?: string;
      readonly events: ReadonlyArray<TimelineEvent>;
    }
  | {
      readonly kind: 'kpi-grid';
      readonly title?: string;
      readonly tiles: ReadonlyArray<KpiTile>;
    }
  | {
      readonly kind: 'prefill-form';
      readonly title?: string;
      readonly formId: string;
      readonly schemaJson: Readonly<Record<string, unknown>>;
      readonly values: Readonly<Record<string, unknown>>;
      readonly action: string;
      readonly diffMode?: boolean;
    }
  | {
      readonly kind: 'approval';
      readonly title?: string;
      readonly action: string;
      readonly payload: Readonly<Record<string, unknown>>;
      readonly diff: Readonly<Record<string, unknown>>;
      readonly checklist: readonly [string, string, string, string, string];
    }
  | {
      readonly kind: 'workflow';
      readonly title?: string;
      readonly steps: ReadonlyArray<WorkflowStep>;
      readonly currentIndex: number;
    }
  | {
      readonly kind: 'map';
      readonly title?: string;
      readonly center: readonly [number, number];
      readonly zoom: number;
      readonly markers: ReadonlyArray<MapMarker>;
    }
  | {
      readonly kind: 'calendar';
      readonly title?: string;
      readonly events: ReadonlyArray<CalendarEvent>;
      readonly view?: 'dayGrid' | 'timeGrid' | 'list';
    }
  | {
      readonly kind: 'file-preview';
      readonly title?: string;
      readonly url: string;
      readonly mimeType: string;
      readonly name: string;
      readonly sizeBytes?: number;
    }
  // ── ProdFix-7 Tier-1 ──────────────────────────────────────────────
  | {
      readonly kind: 'kanban';
      readonly title?: string;
      readonly columns: ReadonlyArray<KanbanColumn>;
    }
  | {
      readonly kind: 'dashboard-grid';
      readonly title?: string;
      readonly cells: ReadonlyArray<{
        readonly span: number;
        readonly part: AgUiUiPart;
      }>;
    }
  | {
      readonly kind: 'heatmap';
      readonly title?: string;
      readonly xAxis: ReadonlyArray<string>;
      readonly yAxis: ReadonlyArray<string>;
      readonly cells: ReadonlyArray<ReadonlyArray<number>>;
      readonly colorScale: 'linear' | 'log' | 'diverging';
      readonly minValue?: number;
      readonly maxValue?: number;
      readonly format: 'currency' | 'percent' | 'count';
      readonly currency?: string;
      readonly unit?: string;
    }
  | {
      readonly kind: 'markdown-card';
      readonly title?: string;
      readonly markdown: string;
      readonly citations?: ReadonlyArray<MarkdownCitation>;
      readonly severity?: 'info' | 'warning' | 'success' | 'danger';
    }
  | {
      readonly kind: 'prompt-suggestions';
      readonly title?: string;
      readonly suggestions: ReadonlyArray<PromptSuggestion>;
    }
  | {
      readonly kind: 'evidence-card';
      readonly title?: string;
      readonly quote: string;
      readonly sourceTitle: string;
      readonly sourceUri?: string;
      readonly sourcePageOrLocator?: string;
      readonly confidence?: 'high' | 'medium' | 'low';
      readonly extractedAt?: string;
    }
  // ── ProdFix-7 Tier-2 ──────────────────────────────────────────────
  | {
      readonly kind: 'tree';
      readonly title?: string;
      readonly root: TreeNode;
    }
  | {
      readonly kind: 'diff-view';
      readonly title?: string;
      readonly left: string;
      readonly right: string;
      readonly leftLabel: string;
      readonly rightLabel: string;
      readonly mode: 'unified' | 'split';
      readonly language?: 'text' | 'json' | 'sql';
    }
  | {
      readonly kind: 'gauge';
      readonly title?: string;
      readonly value: number;
      readonly min: number;
      readonly max: number;
      readonly label: string;
      readonly format?: 'percent' | 'number' | 'currency';
      readonly currency?: string;
      readonly thresholds?: ReadonlyArray<GaugeThreshold>;
    }
  | {
      readonly kind: 'metric-sparkline';
      readonly title?: string;
      readonly label: string;
      readonly value: number;
      readonly format: 'currency' | 'percent' | 'number';
      readonly currency?: string;
      readonly sparkline: ReadonlyArray<number>;
      readonly delta?: number;
      readonly deltaIsPositive?: boolean;
    }
  | {
      readonly kind: 'image-annotation';
      readonly title?: string;
      readonly imageUrl: string;
      readonly annotations: ReadonlyArray<ImageAnnotation>;
    }
  | {
      readonly kind: 'signature-pad';
      readonly title?: string;
      readonly prompt: string;
      readonly requiredFor: string;
      readonly onSubmitAction: SignatureAction;
    }
  // ── Phase E.7 — 13 new kinds ──────────────────────────────────────
  | {
      readonly kind: 'pdf-viewer';
      readonly title?: string;
      readonly url: string;
      readonly name: string;
      readonly initialPage?: number;
      readonly allowAnnotate?: boolean;
      /** Optional i18n override for the zoom-out button aria-label. */
      readonly zoomOutAriaLabel?: string;
      /** Optional i18n override for the zoom-in button aria-label. */
      readonly zoomInAriaLabel?: string;
    }
  | {
      readonly kind: 'slider-input';
      readonly title?: string;
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly step?: number;
      readonly value: number;
      readonly format?: 'number' | 'currency' | 'percent';
      readonly currency?: string;
      readonly onChangeAction: {
        readonly kind: 'tool' | 'message';
        readonly payload: Readonly<Record<string, unknown>>;
      };
    }
  | {
      readonly kind: 'multistep-wizard';
      readonly title?: string;
      readonly steps: ReadonlyArray<WizardStep>;
      readonly currentStepId?: string;
      readonly values?: Readonly<Record<string, unknown>>;
      readonly onSubmitAction: string;
    }
  | {
      readonly kind: 'media-grid';
      readonly title?: string;
      readonly items: ReadonlyArray<MediaGridItem>;
      readonly columns?: number;
    }
  | {
      readonly kind: 'chat-embed';
      readonly title?: string;
      readonly scope: string;
      readonly placeholder?: string;
      readonly initialMessages?: ReadonlyArray<{
        readonly role: 'user' | 'assistant' | 'system';
        readonly text: string;
      }>;
      /** Optional i18n override for the empty-state copy. */
      readonly emptyText?: string;
    }
  | {
      readonly kind: 'live-counter';
      readonly title?: string;
      readonly label: string;
      readonly value: number;
      readonly unit?: string;
      readonly trend?: 'up' | 'down' | 'flat';
      readonly thresholdWarn?: number;
      readonly thresholdCritical?: number;
      readonly updatedAt?: string;
    }
  | {
      readonly kind: 'org-chart';
      readonly title?: string;
      readonly root: OrgChartNode;
      readonly orientation?: 'vertical' | 'horizontal';
    }
  | {
      readonly kind: 'comparison-table';
      readonly title?: string;
      readonly columns: ReadonlyArray<string>;
      readonly rows: ReadonlyArray<ComparisonRow>;
    }
  | {
      readonly kind: 'geo-fence';
      readonly title?: string;
      readonly center: readonly [number, number];
      readonly zoom: number;
      readonly fence?: ReadonlyArray<GeoFencePoint>;
      readonly editable?: boolean;
      readonly onChangeAction?: string;
    }
  | {
      readonly kind: 'notification-toast';
      readonly title?: string;
      readonly message: string;
      readonly severity: 'info' | 'success' | 'warning' | 'error';
      readonly autoCloseMs?: number;
      readonly actionLabel?: string;
      readonly actionPayload?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: 'decision-trace';
      readonly title?: string;
      readonly summary?: string;
      readonly steps: ReadonlyArray<DecisionTraceStep>;
    }
  | {
      readonly kind: 'code-block';
      readonly title?: string;
      readonly code: string;
      readonly language: 'sql' | 'json' | 'log' | 'text' | 'bash' | 'typescript' | 'python';
      readonly filename?: string;
      readonly highlightLines?: ReadonlyArray<number>;
    }
  | {
      readonly kind: 'dataflow-diagram';
      readonly title?: string;
      readonly nodes: ReadonlyArray<DataflowNode>;
      readonly edges: ReadonlyArray<DataflowEdge>;
    };

export type AgUiUiPartByKind<K extends AgUiUiPart['kind']> = Extract<
  AgUiUiPart,
  { kind: K }
>;
