/**
 * AG-UI UiPart placeholder.
 *
 * C1 owns `packages/central-intelligence/src/kernel/streaming/ag-ui-types.ts`
 * which will define the canonical `AgUiUiPart` discriminated union once
 * the AG-UI emitter lands. Until then, this module defines the same
 * shape locally so C3 (Generative UI Primitives) can wire its
 * render-block tools without a circular dependency on C1.
 *
 * Coordination rules:
 *   - This file ONLY mirrors `kind` discriminants + payload shapes.
 *   - Once C1 ships, the canonical types replace this file via barrel
 *     re-export. Do NOT add behaviour here — types only.
 *   - The render-block tools below import `AgUiUiPart` from THIS file;
 *     swapping it for the canonical version is a one-line change in
 *     `index.ts`.
 *
 * Contract:
 *   - Server emits a `tool-output-available` event whose `output` is an
 *     `AgUiUiPart`. The client switches on `kind` and renders the
 *     matching primitive. LLM never emits raw JSX, Tailwind classnames,
 *     or schema modifications — values only.
 */

/** Vega-Lite v5 specification (subset). The full spec is large; we
 *  treat it opaquely as `Record<string, unknown>` and ajv-validate it
 *  against the official Vega-Lite v5 JSON schema before render. */
export type VegaLiteSpec = Readonly<Record<string, unknown>>;

/** A column definition for TanStack Table v8. Subset — the full
 *  ColumnDef shape includes function accessors we don't allow from
 *  the LLM (would mean code emission). */
export interface DataTableColumn {
  readonly id: string;
  readonly header: string;
  /** Path to read from each row, e.g. "tenant.name" or "amountMajor". */
  readonly accessorKey: string;
  /** Optional render hint — primitive owns the actual className/JSX. */
  readonly format?: 'text' | 'currency' | 'percent' | 'number' | 'date';
  /**
   * Optional currency code when format === 'currency'.
   * MUST be an ISO-4217 3-letter code (e.g. KES, TZS, USD, EUR, ZAR, NGN).
   * Validated at runtime via the Zod schema (`CurrencySchema` in
   * `./schemas.ts`).
   */
  readonly currency?: string;
  /** Whether the user can sort by this column. Defaults to true. */
  readonly enableSorting?: boolean;
}

export interface TimelineEvent {
  readonly timestamp: string; // ISO-8601
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
  /**
   * Optional currency code when format === 'currency'.
   * MUST be an ISO-4217 3-letter code (e.g. KES, TZS, USD, EUR, ZAR, NGN).
   * Validated at runtime via the Zod schema (`CurrencySchema` in
   * `./schemas.ts`).
   */
  readonly currency?: string;
}

export interface WorkflowStep {
  readonly label: string;
  readonly status: 'pending' | 'running' | 'done' | 'failed';
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface MapMarker {
  readonly position: readonly [number, number]; // [lat, lng]
  readonly popup?: string;
}

export interface CalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly start: string; // ISO-8601
  readonly end?: string;
  readonly color?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Tier-1 & Tier-2 — ProdFix-7 expansion (12 new kinds)
// ─────────────────────────────────────────────────────────────────────

/** A single kanban card. */
export interface KanbanCard {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly badges?: ReadonlyArray<string>;
  readonly meta?: Readonly<Record<string, string | number>>;
  readonly dueAt?: string; // ISO-8601
}

/** A kanban swimlane column. */
export interface KanbanColumn {
  readonly id: string;
  readonly title: string;
  readonly cards: ReadonlyArray<KanbanCard>;
}

/** Citation marker referenced from markdown-card body via [cite:<id>]. */
export interface MarkdownCitation {
  readonly id: string;
  readonly label: string;
  readonly sourceUri?: string;
  readonly sourceRowRef?: string;
}

/** Prompt-suggestion quick reply. */
export interface PromptSuggestion {
  readonly label: string;
  readonly prompt: string;
  readonly kind: 'primary' | 'secondary' | 'destructive';
  readonly icon?: string;
}

/** Action descriptor for tree node clicks. */
export interface TreeAction {
  readonly kind: 'message' | 'tool' | 'navigate';
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Recursive tree node. */
export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly badge?: string;
  readonly children?: ReadonlyArray<TreeNode>;
  readonly onClickAction?: TreeAction;
}

/** Image-annotation overlay marker. */
export interface ImageAnnotation {
  readonly x: number; // 0..1 normalised
  readonly y: number; // 0..1 normalised
  readonly label: string;
  readonly severity: 'info' | 'warning' | 'critical';
}

/** Gauge threshold band. */
export interface GaugeThreshold {
  readonly value: number;
  readonly color: string; // hex
}

/** Signature-pad submit action. */
export interface SignatureAction {
  readonly kind: 'tool' | 'navigate';
  readonly payload: Readonly<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────────────
// Phase E.7 — 13 new sub-types (ProdFix-8 deferred kinds)
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

/**
 * The discriminated union — every generative UI primitive payload the
 * brain can emit. Each variant matches a server-side render-block
 * tool and a client-side React primitive.
 */
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
      /** JSON Schema (Draft-7) — SERVER-OWNED. LLM may NOT modify. */
      readonly schemaJson: Readonly<Record<string, unknown>>;
      readonly values: Readonly<Record<string, unknown>>;
      /** Action URL on api-gateway to POST validated payload. NOT the agent. */
      readonly action: string;
      readonly diffMode?: boolean;
    }
  | {
      readonly kind: 'approval';
      readonly title?: string;
      readonly action: string;
      readonly payload: Readonly<Record<string, unknown>>;
      readonly diff: Readonly<Record<string, unknown>>;
      /** 5-item challenge-and-response checklist per R1 HIL pattern. */
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
      /** 12-col responsive grid. Each cell can contain another AGUiPart. */
      readonly cells: ReadonlyArray<{
        readonly span: number; // 1..12
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
      readonly currency?: string; // ISO-4217
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
      readonly extractedAt?: string; // ISO-8601
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
      readonly currency?: string; // ISO-4217 when format = 'currency'
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
  // ── Phase E.7 (formerly ProdFix-8) — 13 new kinds ─────────────────
  | {
      readonly kind: 'pdf-viewer';
      readonly title?: string;
      readonly url: string;
      readonly name: string;
      readonly initialPage?: number;
      readonly allowAnnotate?: boolean;
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

/** Narrow `AgUiUiPart` by `kind`. */
export type AgUiUiPartByKind<K extends AgUiUiPart['kind']> = Extract<
  AgUiUiPart,
  { kind: K }
>;

/** All known UiPart kinds — useful for runtime registries / switch
 *  exhaustiveness checks. */
export const AG_UI_UI_PART_KINDS = [
  'chart-vega',
  'data-table',
  'timeline',
  'kpi-grid',
  'prefill-form',
  'approval',
  'workflow',
  'map',
  'calendar',
  'file-preview',
  // ProdFix-7 Tier-1
  'kanban',
  'dashboard-grid',
  'heatmap',
  'markdown-card',
  'prompt-suggestions',
  'evidence-card',
  // ProdFix-7 Tier-2
  'tree',
  'diff-view',
  'gauge',
  'metric-sparkline',
  'image-annotation',
  'signature-pad',
  // Phase E.7 (formerly ProdFix-8) — 13 new kinds
  'pdf-viewer',
  'slider-input',
  'multistep-wizard',
  'media-grid',
  'chat-embed',
  'live-counter',
  'org-chart',
  'comparison-table',
  'geo-fence',
  'notification-toast',
  'decision-trace',
  'code-block',
  'dataflow-diagram',
] as const;

export type AgUiUiPartKind = (typeof AG_UI_UI_PART_KINDS)[number];
