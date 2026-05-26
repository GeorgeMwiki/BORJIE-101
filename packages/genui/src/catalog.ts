/**
 * Piece-G GenUI artifact catalog.
 *
 * The brain may only emit `component_type` values that appear in this
 * catalog. Each entry pairs a snake_case canonical key (the value
 * persisted into `ui_artifacts.component_type` in the database) with a
 * Zod schema for its full artifact payload, the existing PartKind it
 * maps to in `packages/genui` (so the renderer can dispatch via the
 * existing AdaptiveRenderer registry), and human metadata used by the
 * `list_artifact_types` LLM tool.
 *
 * The catalog is THE security boundary: any `component_type` not in this
 * file is rejected at the render layer and surfaced as
 * `UnknownKindCard`. Combined with the per-primitive `safeParse` already
 * present in every primitive, this matches the 2026 Vercel AI SDK 5
 * "generative UI on rails" pattern — the LLM never emits raw JSX/HTML,
 * only tool-call args that select + parametrise pre-registered
 * components.
 *
 * Adding a new catalog entry:
 *   1. Add the artifact schema (`<CamelCase>ArtifactSchema`) in this file
 *      OR reuse one of the existing PartKind schemas.
 *   2. Register it in `ARTIFACT_CATALOG` below.
 *   3. The renderer auto-dispatches via the `partKind` field.
 */

import { z } from 'zod';

import type { PartKind } from './schemas';

// ─────────────────────────────────────────────────────────────────────
// Section A — Zod artifact wrappers for the canonical 30 catalog types.
//
// Each artifact schema captures the props + data that ship over the wire
// inside `ui_artifacts.props_jsonb` + `ui_artifacts.data_jsonb`. The
// underlying renderer projects them down to the existing AgUiUiPart
// shape via the `toUiPart()` projector at the bottom of this file.
// ─────────────────────────────────────────────────────────────────────

const Iso4217 = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/);

// 1. kpi_tile — single KPI metric with optional sparkline.
export const KpiTileArtifactSchema = z
  .object({
    component_type: z.literal('kpi_tile'),
    props: z
      .object({
        label: z.string().min(1).max(120),
        format: z.enum(['currency', 'percent', 'number']).default('number'),
        currency: Iso4217.optional(),
      })
      .strict(),
    data: z
      .object({
        value: z.union([z.number(), z.string()]),
        delta: z.number().optional(),
        deltaDirection: z.enum(['up', 'down', 'flat']).optional(),
      })
      .strict(),
  })
  .strict();

// 2. bar_chart — vega bar mark.
export const BarChartArtifactSchema = z
  .object({
    component_type: z.literal('bar_chart'),
    props: z
      .object({
        xField: z.string().min(1).max(120),
        yField: z.string().min(1).max(120),
        title: z.string().max(200).optional(),
        orientation: z.enum(['vertical', 'horizontal']).default('vertical'),
      })
      .strict(),
    data: z.object({ rows: z.array(z.record(z.unknown())).max(50_000) }).strict(),
  })
  .strict();

// 3. line_chart — vega line mark.
export const LineChartArtifactSchema = z
  .object({
    component_type: z.literal('line_chart'),
    props: z
      .object({
        xField: z.string().min(1).max(120),
        yField: z.string().min(1).max(120),
        seriesField: z.string().max(120).optional(),
        title: z.string().max(200).optional(),
      })
      .strict(),
    data: z.object({ rows: z.array(z.record(z.unknown())).max(50_000) }).strict(),
  })
  .strict();

// 4. pie_chart — vega arc mark.
export const PieChartArtifactSchema = z
  .object({
    component_type: z.literal('pie_chart'),
    props: z
      .object({
        categoryField: z.string().min(1).max(120),
        valueField: z.string().min(1).max(120),
        title: z.string().max(200).optional(),
        innerRadius: z.number().min(0).max(0.95).default(0),
      })
      .strict(),
    data: z.object({ rows: z.array(z.record(z.unknown())).max(500) }).strict(),
  })
  .strict();

// 5. data_table — generic tabular data. Props delegated to the
//    underlying primitive's schema; we keep this entry permissive
//    because DataTablePartSchema already validates row + column shape
//    at the render boundary.
export const DataTableArtifactSchema = z
  .object({
    component_type: z.literal('data_table'),
    props: z.record(z.unknown()),
    data: z.record(z.unknown()).optional(),
  })
  .strict();

// 6. form — prefill form (read-only diff + commit).
export const FormArtifactSchema = z
  .object({
    component_type: z.literal('form'),
    props: z.record(z.unknown()),
    data: z.record(z.unknown()).optional(),
  })
  .strict();

// 7. deck_slide — single slide for emit-as-pitch-deck flow.
export const DeckSlideArtifactSchema = z
  .object({
    component_type: z.literal('deck_slide'),
    props: z
      .object({
        title: z.string().min(1).max(200),
        subtitle: z.string().max(300).optional(),
        layout: z
          .enum(['title-only', 'title-bullet', 'title-image', 'split'])
          .default('title-bullet'),
        accentColor: z.string().max(40).optional(),
      })
      .strict(),
    data: z
      .object({
        bullets: z.array(z.string().max(400)).max(8).optional(),
        imageUrl: z.string().url().max(2000).optional(),
        body: z.string().max(4000).optional(),
        speakerNotes: z.string().max(4000).optional(),
      })
      .strict(),
  })
  .strict();

// 8. doc_section — long-form markdown section in chat (≠ markdown_card; this
//    is the structured doc primitive used for emit-as-document flow).
export const DocSectionArtifactSchema = z
  .object({
    component_type: z.literal('doc_section'),
    props: z
      .object({
        heading: z.string().min(1).max(200),
        level: z.number().int().min(1).max(6).default(2),
        anchor: z.string().max(120).optional(),
      })
      .strict(),
    data: z.object({ markdown: z.string().max(20_000) }).strict(),
  })
  .strict();

// 9. map_view — geographic map with markers.
export const MapViewArtifactSchema = z
  .object({
    component_type: z.literal('map_view'),
    props: z.record(z.unknown()),
    data: z.object({}).passthrough().optional(),
  })
  .strict();

// 10. heatmap — 2D numeric heatmap.
export const HeatmapArtifactSchema = z
  .object({
    component_type: z.literal('heatmap'),
    props: z.record(z.unknown()),
    data: z.object({}).passthrough().optional(),
  })
  .strict();

// 11. timeline — vertical timeline of events.
export const TimelineArtifactSchema = z
  .object({
    component_type: z.literal('timeline'),
    props: z.record(z.unknown()),
    data: z.object({}).passthrough().optional(),
  })
  .strict();

// 12. kanban — board with columns + cards.
export const KanbanArtifactSchema = z
  .object({
    component_type: z.literal('kanban'),
    props: z.record(z.unknown()),
    data: z.object({}).passthrough().optional(),
  })
  .strict();

// 13. gantt — project gantt (TODO(#37): rich impl; current renders fallback bars).
export const GanttArtifactSchema = z
  .object({
    component_type: z.literal('gantt'),
    props: z
      .object({
        title: z.string().max(200).optional(),
        rangeStart: z.string().min(1).max(40),
        rangeEnd: z.string().min(1).max(40),
      })
      .strict(),
    data: z
      .object({
        bars: z
          .array(
            z
              .object({
                id: z.string().min(1).max(120),
                label: z.string().min(1).max(200),
                start: z.string().min(1).max(40),
                end: z.string().min(1).max(40),
                status: z
                  .enum(['pending', 'running', 'done', 'failed'])
                  .default('pending'),
                progress: z.number().min(0).max(1).optional(),
                dependsOn: z.array(z.string()).max(50).optional(),
              })
              .strict(),
          )
          .max(500),
      })
      .strict(),
  })
  .strict();

// 14. funnel — vega trapezoid funnel chart.
export const FunnelArtifactSchema = z
  .object({
    component_type: z.literal('funnel'),
    props: z
      .object({
        title: z.string().max(200).optional(),
        labelField: z.string().min(1).max(120),
        valueField: z.string().min(1).max(120),
      })
      .strict(),
    data: z
      .object({
        rows: z
          .array(
            z
              .object({})
              .passthrough(),
          )
          .max(50),
      })
      .strict(),
  })
  .strict();

// 15. metric_grid — grid of multiple KPI tiles.
export const MetricGridArtifactSchema = z
  .object({
    component_type: z.literal('metric_grid'),
    props: z.record(z.unknown()),
    data: z.object({}).passthrough().optional(),
  })
  .strict();

// 16. image — single image with caption.
export const ImageArtifactSchema = z
  .object({
    component_type: z.literal('image'),
    props: z
      .object({
        alt: z.string().min(1).max(300),
        caption: z.string().max(400).optional(),
        aspectRatio: z.enum(['auto', '16:9', '4:3', '1:1', '3:4']).default('auto'),
      })
      .strict(),
    data: z
      .object({
        url: z.string().url().max(2000),
        sizeBytes: z.number().int().min(0).max(50_000_000).optional(),
      })
      .strict(),
  })
  .strict();

// 17. video — single video player.
export const VideoArtifactSchema = z
  .object({
    component_type: z.literal('video'),
    props: z
      .object({
        title: z.string().max(200).optional(),
        poster: z.string().url().max(2000).optional(),
        autoplay: z.boolean().default(false),
        loop: z.boolean().default(false),
        muted: z.boolean().default(true),
      })
      .strict(),
    data: z
      .object({
        url: z.string().url().max(2000),
        mimeType: z.string().min(1).max(120),
        durationSec: z.number().int().min(0).max(86_400).optional(),
      })
      .strict(),
  })
  .strict();

// 18. code_block — syntax-highlighted code.
export const CodeBlockArtifactSchema = z
  .object({
    component_type: z.literal('code_block'),
    props: z.record(z.unknown()),
    data: z.object({}).passthrough().optional(),
  })
  .strict();

// 19. markdown — markdown card with citations + severity.
export const MarkdownArtifactSchema = z
  .object({
    component_type: z.literal('markdown'),
    props: z.record(z.unknown()),
    data: z.object({}).passthrough().optional(),
  })
  .strict();

// 20. callout — single emphasised note ("Tip / Warning / Danger").
export const CalloutArtifactSchema = z
  .object({
    component_type: z.literal('callout'),
    props: z
      .object({
        severity: z.enum(['info', 'success', 'warning', 'danger']).default('info'),
        title: z.string().max(200).optional(),
        icon: z.string().max(60).optional(),
      })
      .strict(),
    data: z.object({ message: z.string().min(1).max(2000) }).strict(),
  })
  .strict();

// 21. comparison — multi-column comparison table.
export const ComparisonArtifactSchema = z
  .object({
    component_type: z.literal('comparison'),
    props: z.record(z.unknown()),
    data: z.object({}).passthrough().optional(),
  })
  .strict();

// 22. pivot_table — multi-dimensional pivot.
export const PivotTableArtifactSchema = z
  .object({
    component_type: z.literal('pivot_table'),
    props: z
      .object({
        title: z.string().max(200).optional(),
        rowDimensions: z.array(z.string().min(1).max(120)).min(1).max(5),
        colDimensions: z.array(z.string().min(1).max(120)).max(5),
        measures: z
          .array(
            z
              .object({
                field: z.string().min(1).max(120),
                aggregator: z.enum(['sum', 'avg', 'min', 'max', 'count']),
                format: z.enum(['number', 'currency', 'percent']).default('number'),
                currency: Iso4217.optional(),
              })
              .strict(),
          )
          .min(1)
          .max(10),
      })
      .strict(),
    data: z.object({ rows: z.array(z.record(z.unknown())).max(50_000) }).strict(),
  })
  .strict();

// 23. sparkline — small inline metric sparkline.
export const SparklineArtifactSchema = z
  .object({
    component_type: z.literal('sparkline'),
    props: z.record(z.unknown()),
    data: z.object({}).passthrough().optional(),
  })
  .strict();

// 24. treemap — hierarchical treemap.
export const TreemapArtifactSchema = z
  .object({
    component_type: z.literal('treemap'),
    props: z
      .object({
        title: z.string().max(200).optional(),
        labelField: z.string().min(1).max(120),
        valueField: z.string().min(1).max(120),
        groupField: z.string().max(120).optional(),
      })
      .strict(),
    data: z.object({ rows: z.array(z.record(z.unknown())).max(5_000) }).strict(),
  })
  .strict();

// 25. sankey — sankey / flow diagram (vega-lite via custom transform).
export const SankeyArtifactSchema = z
  .object({
    component_type: z.literal('sankey'),
    props: z
      .object({
        title: z.string().max(200).optional(),
        sourceField: z.string().min(1).max(120).default('source'),
        targetField: z.string().min(1).max(120).default('target'),
        valueField: z.string().min(1).max(120).default('value'),
      })
      .strict(),
    data: z
      .object({
        links: z
          .array(
            z
              .object({
                source: z.string().min(1).max(120),
                target: z.string().min(1).max(120),
                value: z.number().nonnegative().finite(),
              })
              .strict(),
          )
          .max(2_000),
      })
      .strict(),
  })
  .strict();

// 26. scatter — vega scatter.
export const ScatterArtifactSchema = z
  .object({
    component_type: z.literal('scatter'),
    props: z
      .object({
        title: z.string().max(200).optional(),
        xField: z.string().min(1).max(120),
        yField: z.string().min(1).max(120),
        sizeField: z.string().max(120).optional(),
        colorField: z.string().max(120).optional(),
      })
      .strict(),
    data: z.object({ rows: z.array(z.record(z.unknown())).max(50_000) }).strict(),
  })
  .strict();

// 27. gauge — single-value gauge.
export const GaugeArtifactSchema = z
  .object({
    component_type: z.literal('gauge'),
    props: z.record(z.unknown()),
    data: z.object({}).passthrough().optional(),
  })
  .strict();

// 28. radar — radar / polygon chart.
export const RadarArtifactSchema = z
  .object({
    component_type: z.literal('radar'),
    props: z
      .object({
        title: z.string().max(200).optional(),
        axisField: z.string().min(1).max(120),
        valueField: z.string().min(1).max(120),
        seriesField: z.string().max(120).optional(),
      })
      .strict(),
    data: z.object({ rows: z.array(z.record(z.unknown())).max(2_000) }).strict(),
  })
  .strict();

// 29. box_plot — box-and-whiskers via vega.
export const BoxPlotArtifactSchema = z
  .object({
    component_type: z.literal('box_plot'),
    props: z
      .object({
        title: z.string().max(200).optional(),
        groupField: z.string().min(1).max(120),
        valueField: z.string().min(1).max(120),
      })
      .strict(),
    data: z.object({ rows: z.array(z.record(z.unknown())).max(50_000) }).strict(),
  })
  .strict();

// 30. histogram — single-axis vega histogram.
export const HistogramArtifactSchema = z
  .object({
    component_type: z.literal('histogram'),
    props: z
      .object({
        title: z.string().max(200).optional(),
        valueField: z.string().min(1).max(120),
        binCount: z.number().int().min(2).max(200).default(20),
      })
      .strict(),
    data: z.object({ rows: z.array(z.record(z.unknown())).max(50_000) }).strict(),
  })
  .strict();

// 31. org_chart — hierarchical org chart (extra entry — ≥30 requirement).
export const OrgChartArtifactSchema = z
  .object({
    component_type: z.literal('org_chart'),
    props: z.record(z.unknown()),
    data: z.object({}).passthrough().optional(),
  })
  .strict();

// 32. workflow — workflow / pipeline progress (bonus, off the explicit list).
export const WorkflowArtifactSchema = z
  .object({
    component_type: z.literal('workflow'),
    props: z.record(z.unknown()),
    data: z.object({}).passthrough().optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────
// Section B — Catalog table.
// Each entry maps the snake_case catalog key → its Zod schema + the
// PartKind it dispatches into in the renderer + human metadata used by
// the `list_artifact_types` LLM tool.
// ─────────────────────────────────────────────────────────────────────

export type ArtifactComponentType =
  | 'kpi_tile'
  | 'bar_chart'
  | 'line_chart'
  | 'pie_chart'
  | 'data_table'
  | 'form'
  | 'deck_slide'
  | 'doc_section'
  | 'map_view'
  | 'heatmap'
  | 'timeline'
  | 'kanban'
  | 'gantt'
  | 'funnel'
  | 'metric_grid'
  | 'image'
  | 'video'
  | 'code_block'
  | 'markdown'
  | 'callout'
  | 'comparison'
  | 'pivot_table'
  | 'sparkline'
  | 'treemap'
  | 'sankey'
  | 'scatter'
  | 'gauge'
  | 'radar'
  | 'box_plot'
  | 'histogram'
  | 'org_chart'
  | 'workflow';

export interface ArtifactCatalogEntry {
  readonly key: ArtifactComponentType;
  /** Underlying primitive used by AdaptiveRenderer. */
  readonly partKind: PartKind;
  readonly title: string;
  readonly description: string;
  /** Whether the artifact requires interactivity (e.g. form / kanban). */
  readonly interactive: boolean;
  /** Whether the artifact can be safely SSR-rendered to PNG / PDF. */
  readonly ssrCapable: boolean;
  readonly schema: z.ZodTypeAny;
}

export const ARTIFACT_CATALOG: ReadonlyArray<ArtifactCatalogEntry> = [
  {
    key: 'kpi_tile',
    partKind: 'kpi-grid',
    title: 'KPI Tile',
    description: 'Single headline KPI metric with delta direction.',
    interactive: false,
    ssrCapable: true,
    schema: KpiTileArtifactSchema,
  },
  {
    key: 'bar_chart',
    partKind: 'chart-vega',
    title: 'Bar Chart',
    description: 'Categorical bar chart, vertical or horizontal.',
    interactive: false,
    ssrCapable: true,
    schema: BarChartArtifactSchema,
  },
  {
    key: 'line_chart',
    partKind: 'chart-vega',
    title: 'Line Chart',
    description: 'Time-series or sequenced line chart with optional series.',
    interactive: false,
    ssrCapable: true,
    schema: LineChartArtifactSchema,
  },
  {
    key: 'pie_chart',
    partKind: 'chart-vega',
    title: 'Pie / Donut Chart',
    description: 'Proportional category chart; donut when innerRadius > 0.',
    interactive: false,
    ssrCapable: true,
    schema: PieChartArtifactSchema,
  },
  {
    key: 'data_table',
    partKind: 'data-table',
    title: 'Data Table',
    description: 'Sortable, formatted tabular data view.',
    interactive: true,
    ssrCapable: true,
    schema: DataTableArtifactSchema,
  },
  {
    key: 'form',
    partKind: 'prefill-form',
    title: 'Prefill Form',
    description: 'Read-only diff + commit form bound to a server action.',
    interactive: true,
    ssrCapable: false,
    schema: FormArtifactSchema,
  },
  {
    key: 'deck_slide',
    partKind: 'markdown-card',
    title: 'Deck Slide',
    description: 'Single titled slide with bullets / image / split layout.',
    interactive: false,
    ssrCapable: true,
    schema: DeckSlideArtifactSchema,
  },
  {
    key: 'doc_section',
    partKind: 'markdown-card',
    title: 'Document Section',
    description: 'Long-form headed markdown section in a generated doc.',
    interactive: false,
    ssrCapable: true,
    schema: DocSectionArtifactSchema,
  },
  {
    key: 'map_view',
    partKind: 'map',
    title: 'Map View',
    description: 'Geographic map with markers + popups.',
    interactive: true,
    ssrCapable: true,
    schema: MapViewArtifactSchema,
  },
  {
    key: 'heatmap',
    partKind: 'heatmap',
    title: 'Heatmap',
    description: '2D numeric heatmap with linear / log / diverging scale.',
    interactive: false,
    ssrCapable: true,
    schema: HeatmapArtifactSchema,
  },
  {
    key: 'timeline',
    partKind: 'timeline',
    title: 'Timeline',
    description: 'Chronological event timeline with severity badges.',
    interactive: false,
    ssrCapable: true,
    schema: TimelineArtifactSchema,
  },
  {
    key: 'kanban',
    partKind: 'kanban',
    title: 'Kanban Board',
    description: 'Multi-column board with draggable cards.',
    interactive: true,
    ssrCapable: true,
    schema: KanbanArtifactSchema,
  },
  {
    key: 'gantt',
    partKind: 'workflow',
    title: 'Gantt Chart',
    description: 'Project gantt with dependencies + status.',
    interactive: false,
    ssrCapable: true,
    schema: GanttArtifactSchema,
  },
  {
    key: 'funnel',
    partKind: 'chart-vega',
    title: 'Funnel Chart',
    description: 'Conversion funnel chart.',
    interactive: false,
    ssrCapable: true,
    schema: FunnelArtifactSchema,
  },
  {
    key: 'metric_grid',
    partKind: 'kpi-grid',
    title: 'Metric Grid',
    description: 'Grid of multiple KPI tiles.',
    interactive: false,
    ssrCapable: true,
    schema: MetricGridArtifactSchema,
  },
  {
    key: 'image',
    partKind: 'media-grid',
    title: 'Image',
    description: 'Single image with caption + aspect-ratio control.',
    interactive: false,
    ssrCapable: true,
    schema: ImageArtifactSchema,
  },
  {
    key: 'video',
    partKind: 'media-grid',
    title: 'Video',
    description: 'Single video player with poster + autoplay options.',
    interactive: true,
    ssrCapable: false,
    schema: VideoArtifactSchema,
  },
  {
    key: 'code_block',
    partKind: 'code-block',
    title: 'Code Block',
    description: 'Syntax-highlighted code with optional line highlights.',
    interactive: false,
    ssrCapable: true,
    schema: CodeBlockArtifactSchema,
  },
  {
    key: 'markdown',
    partKind: 'markdown-card',
    title: 'Markdown Card',
    description: 'Rendered markdown with severity + citations.',
    interactive: false,
    ssrCapable: true,
    schema: MarkdownArtifactSchema,
  },
  {
    key: 'callout',
    partKind: 'markdown-card',
    title: 'Callout',
    description: 'Single emphasised note with severity icon.',
    interactive: false,
    ssrCapable: true,
    schema: CalloutArtifactSchema,
  },
  {
    key: 'comparison',
    partKind: 'comparison-table',
    title: 'Comparison Table',
    description: 'Multi-column side-by-side comparison.',
    interactive: false,
    ssrCapable: true,
    schema: ComparisonArtifactSchema,
  },
  {
    key: 'pivot_table',
    partKind: 'data-table',
    title: 'Pivot Table',
    description: 'Multi-dimensional pivot with aggregator measures.',
    interactive: true,
    ssrCapable: true,
    schema: PivotTableArtifactSchema,
  },
  {
    key: 'sparkline',
    partKind: 'metric-sparkline',
    title: 'Sparkline',
    description: 'Small inline metric sparkline with delta.',
    interactive: false,
    ssrCapable: true,
    schema: SparklineArtifactSchema,
  },
  {
    key: 'treemap',
    partKind: 'chart-vega',
    title: 'Treemap',
    description: 'Hierarchical treemap of proportional values.',
    interactive: false,
    ssrCapable: true,
    schema: TreemapArtifactSchema,
  },
  {
    key: 'sankey',
    partKind: 'chart-vega',
    title: 'Sankey Diagram',
    description: 'Flow diagram between source and target nodes.',
    interactive: false,
    ssrCapable: true,
    schema: SankeyArtifactSchema,
  },
  {
    key: 'scatter',
    partKind: 'chart-vega',
    title: 'Scatter Plot',
    description: 'XY scatter chart with optional size + colour encoding.',
    interactive: false,
    ssrCapable: true,
    schema: ScatterArtifactSchema,
  },
  {
    key: 'gauge',
    partKind: 'gauge',
    title: 'Gauge',
    description: 'Single-value circular gauge with thresholds.',
    interactive: false,
    ssrCapable: true,
    schema: GaugeArtifactSchema,
  },
  {
    key: 'radar',
    partKind: 'chart-vega',
    title: 'Radar Chart',
    description: 'Polygon / radar chart across axes per series.',
    interactive: false,
    ssrCapable: true,
    schema: RadarArtifactSchema,
  },
  {
    key: 'box_plot',
    partKind: 'chart-vega',
    title: 'Box Plot',
    description: 'Box-and-whiskers across groups.',
    interactive: false,
    ssrCapable: true,
    schema: BoxPlotArtifactSchema,
  },
  {
    key: 'histogram',
    partKind: 'chart-vega',
    title: 'Histogram',
    description: 'Single-variable frequency histogram.',
    interactive: false,
    ssrCapable: true,
    schema: HistogramArtifactSchema,
  },
  {
    key: 'org_chart',
    partKind: 'org-chart',
    title: 'Org Chart',
    description: 'Hierarchical organisational chart.',
    interactive: false,
    ssrCapable: true,
    schema: OrgChartArtifactSchema,
  },
  {
    key: 'workflow',
    partKind: 'workflow',
    title: 'Workflow',
    description: 'Step-by-step workflow / pipeline progress.',
    interactive: false,
    ssrCapable: true,
    schema: WorkflowArtifactSchema,
  },
];

if (ARTIFACT_CATALOG.length < 30) {
  // Belt-and-suspenders compile-time check; the catalog is the security
  // boundary, so we want CI to scream if anyone deletes entries.
  throw new Error(
    `Piece-G catalog regression: expected ≥30 component types, got ${ARTIFACT_CATALOG.length}.`,
  );
}

/** Index by key for O(1) lookup. */
export const ARTIFACT_CATALOG_BY_KEY: Readonly<
  Record<ArtifactComponentType, ArtifactCatalogEntry>
> = Object.freeze(
  Object.fromEntries(
    ARTIFACT_CATALOG.map((entry) => [entry.key, entry]),
  ) as Record<ArtifactComponentType, ArtifactCatalogEntry>,
);

/** Stable, public list of catalog keys. */
export const ARTIFACT_COMPONENT_TYPES: ReadonlyArray<ArtifactComponentType> =
  Object.freeze(ARTIFACT_CATALOG.map((entry) => entry.key));

/**
 * Used by the brain's `list_artifact_types` tool. Returns the catalog
 * minus the raw Zod schema (schemas don't serialise; the brain needs the
 * description + an example URL into the docs).
 */
export interface ArtifactCatalogSummary {
  readonly key: ArtifactComponentType;
  readonly title: string;
  readonly description: string;
  readonly interactive: boolean;
  readonly ssrCapable: boolean;
  readonly partKind: PartKind;
}

export function listArtifactTypes(): ReadonlyArray<ArtifactCatalogSummary> {
  return ARTIFACT_CATALOG.map((entry) => ({
    key: entry.key,
    title: entry.title,
    description: entry.description,
    interactive: entry.interactive,
    ssrCapable: entry.ssrCapable,
    partKind: entry.partKind,
  }));
}
