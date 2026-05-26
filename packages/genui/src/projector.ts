/**
 * Catalog payload → AgUiUiPart projector.
 *
 * The catalog stores artifact payloads as `{ props, data }` blobs. The
 * AdaptiveRenderer dispatch table operates on the existing
 * `AgUiUiPart` discriminated-union shape. This module is the explicit
 * bridge.
 *
 * Every projection is EXPLICIT — no string interpolation, no eval, no
 * dangerouslySetInnerHTML. The caller (`UiArtifact`) has already run
 * the Zod schema for the catalog entry before invoking us, so we can
 * trust the field shapes and concentrate on the mapping.
 *
 * Returns `null` ONLY when a catalog key is registered without a
 * projection rule (a developer-time wiring bug); the renderer surfaces
 * such cases as `UnknownKindCard`.
 */

import type { ArtifactComponentType } from './catalog';
import type {
  AgUiUiPart,
  VegaLiteSpec,
  KpiTile,
  WorkflowStep,
} from './types';

type Props = Readonly<Record<string, unknown>>;
type Data = Readonly<Record<string, unknown>>;

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asArray<T = unknown>(v: unknown): ReadonlyArray<T> {
  return Array.isArray(v) ? (v as ReadonlyArray<T>) : [];
}

function asRecord(v: unknown): Props {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Props)
    : {};
}

/**
 * Build a minimal vega-lite spec for the common chart catalog entries.
 * Production hosts can override via the chart-vega primitive's full
 * spec field; this default keeps us safe-by-construction.
 */
function vegaSpecFor(
  mark: 'bar' | 'line' | 'arc' | 'point' | 'rect' | 'boxplot',
  encoding: Readonly<Record<string, unknown>>,
): VegaLiteSpec {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    mark,
    encoding,
  };
}

export function projectArtifactToUiPart(
  componentType: ArtifactComponentType,
  rawProps: Props,
  rawData: Data,
): AgUiUiPart | null {
  const props = rawProps;
  const data = rawData;

  switch (componentType) {
    case 'kpi_tile': {
      const tile: KpiTile = {
        label: asString(props.label, 'Metric'),
        value: typeof data.value === 'number' ? data.value : asString(data.value, '—'),
        format:
          (props.format as KpiTile['format']) ?? 'number',
        ...(typeof data.delta === 'number' ? { delta: data.delta as number } : {}),
        ...(data.deltaDirection
          ? { deltaDirection: data.deltaDirection as KpiTile['deltaDirection'] }
          : {}),
        ...(props.currency ? { currency: asString(props.currency) } : {}),
      };
      return { kind: 'kpi-grid', tiles: [tile] };
    }

    case 'metric_grid': {
      const tiles = asArray<KpiTile>(props.tiles ?? data.tiles);
      return {
        kind: 'kpi-grid',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        tiles: tiles.length > 0 ? tiles : [
          { label: 'Empty', value: '—', format: 'number' },
        ],
      };
    }

    case 'bar_chart': {
      const xField = asString(props.xField, 'x');
      const yField = asString(props.yField, 'y');
      const orientation = props.orientation === 'horizontal' ? 'horizontal' : 'vertical';
      const encoding =
        orientation === 'horizontal'
          ? { x: { field: yField, type: 'quantitative' }, y: { field: xField, type: 'nominal' } }
          : { x: { field: xField, type: 'nominal' }, y: { field: yField, type: 'quantitative' } };
      return {
        kind: 'chart-vega',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        spec: vegaSpecFor('bar', encoding),
        data: asArray<Props>(data.rows),
      };
    }

    case 'line_chart': {
      const encoding: Record<string, unknown> = {
        x: { field: asString(props.xField, 'x'), type: 'temporal' },
        y: { field: asString(props.yField, 'y'), type: 'quantitative' },
      };
      if (typeof props.seriesField === 'string' && props.seriesField.length > 0) {
        encoding.color = { field: props.seriesField, type: 'nominal' };
      }
      return {
        kind: 'chart-vega',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        spec: vegaSpecFor('line', encoding),
        data: asArray<Props>(data.rows),
      };
    }

    case 'pie_chart': {
      const encoding: Record<string, unknown> = {
        theta: { field: asString(props.valueField, 'value'), type: 'quantitative' },
        color: { field: asString(props.categoryField, 'category'), type: 'nominal' },
      };
      const spec = {
        ...vegaSpecFor('arc', encoding),
        ...(typeof props.innerRadius === 'number'
          ? { mark: { type: 'arc', innerRadius: props.innerRadius * 100 } }
          : {}),
      };
      return {
        kind: 'chart-vega',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        spec,
        data: asArray<Props>(data.rows),
      };
    }

    case 'scatter': {
      const encoding: Record<string, unknown> = {
        x: { field: asString(props.xField, 'x'), type: 'quantitative' },
        y: { field: asString(props.yField, 'y'), type: 'quantitative' },
      };
      if (typeof props.sizeField === 'string') {
        encoding.size = { field: props.sizeField, type: 'quantitative' };
      }
      if (typeof props.colorField === 'string') {
        encoding.color = { field: props.colorField, type: 'nominal' };
      }
      return {
        kind: 'chart-vega',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        spec: vegaSpecFor('point', encoding),
        data: asArray<Props>(data.rows),
      };
    }

    case 'funnel': {
      const encoding = {
        x: { field: asString(props.valueField, 'value'), type: 'quantitative' },
        y: { field: asString(props.labelField, 'label'), type: 'nominal', sort: '-x' },
      };
      return {
        kind: 'chart-vega',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        spec: vegaSpecFor('bar', encoding),
        data: asArray<Props>(data.rows),
      };
    }

    case 'treemap': {
      const encoding = {
        x: { field: asString(props.labelField, 'label'), type: 'nominal' },
        y: { field: asString(props.valueField, 'value'), type: 'quantitative' },
      };
      return {
        kind: 'chart-vega',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        spec: vegaSpecFor('rect', encoding),
        data: asArray<Props>(data.rows),
      };
    }

    case 'sankey': {
      // Vega-lite has no native sankey; we ship the link table as data
      // and the renderer's host can opt into a richer projection later.
      const encoding = {
        x: { field: 'source', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
        color: { field: 'target', type: 'nominal' },
      };
      return {
        kind: 'chart-vega',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        spec: vegaSpecFor('bar', encoding),
        data: asArray<Props>(data.links),
      };
    }

    case 'radar': {
      const encoding: Record<string, unknown> = {
        theta: { field: asString(props.axisField, 'axis'), type: 'nominal' },
        radius: { field: asString(props.valueField, 'value'), type: 'quantitative' },
      };
      if (typeof props.seriesField === 'string') {
        encoding.color = { field: props.seriesField, type: 'nominal' };
      }
      return {
        kind: 'chart-vega',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        spec: vegaSpecFor('point', encoding),
        data: asArray<Props>(data.rows),
      };
    }

    case 'box_plot': {
      const encoding = {
        x: { field: asString(props.groupField, 'group'), type: 'nominal' },
        y: { field: asString(props.valueField, 'value'), type: 'quantitative' },
      };
      return {
        kind: 'chart-vega',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        spec: vegaSpecFor('boxplot', encoding),
        data: asArray<Props>(data.rows),
      };
    }

    case 'histogram': {
      const encoding = {
        x: {
          field: asString(props.valueField, 'value'),
          type: 'quantitative',
          bin: { maxbins: asNumber(props.binCount, 20) },
        },
        y: { aggregate: 'count', type: 'quantitative' },
      };
      return {
        kind: 'chart-vega',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        spec: vegaSpecFor('bar', encoding),
        data: asArray<Props>(data.rows),
      };
    }

    case 'data_table':
    case 'pivot_table': {
      const columns = asArray(props.columns);
      const rows = asArray(props.rows ?? data.rows);
      return {
        kind: 'data-table',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        columns:
          columns.length > 0
            ? (columns as ReadonlyArray<never>)
            : [
                {
                  id: 'col-1',
                  header: 'Value',
                  accessorKey: 'value',
                } as never,
              ],
        rows: rows as ReadonlyArray<Props>,
        ...(typeof props.pageSize === 'number' ? { pageSize: props.pageSize } : {}),
      };
    }

    case 'form': {
      return {
        kind: 'prefill-form',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        formId: asString(props.formId, 'unnamed-form'),
        schemaJson: asRecord(props.schemaJson),
        values: asRecord(props.values ?? data.values),
        action: asString(props.action, '/api/gateway/forms/unnamed'),
        ...(typeof props.diffMode === 'boolean' ? { diffMode: props.diffMode } : {}),
      };
    }

    case 'deck_slide': {
      // Project a slide to a markdown card; SSR renderer adds the
      // logo + theme background.
      const title = asString(props.title, 'Slide');
      const bullets = asArray<string>(data.bullets);
      const body = asString(data.body, '');
      const md =
        `# ${title}\n` +
        (bullets.length > 0
          ? bullets.map((b) => `- ${b}`).join('\n') + '\n'
          : '') +
        (body ? `\n${body}` : '');
      return {
        kind: 'markdown-card',
        title,
        markdown: md,
      };
    }

    case 'doc_section': {
      const heading = asString(props.heading, 'Section');
      const level = asNumber(props.level, 2);
      const md = `${'#'.repeat(Math.min(6, Math.max(1, Math.floor(level))))} ${heading}\n\n${asString(
        data.markdown,
        '',
      )}`;
      return { kind: 'markdown-card', title: heading, markdown: md };
    }

    case 'markdown': {
      return {
        kind: 'markdown-card',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        markdown: asString(props.markdown ?? data.markdown, ''),
        ...(props.severity
          ? { severity: props.severity as 'info' | 'warning' | 'success' | 'danger' }
          : {}),
      };
    }

    case 'callout': {
      const severity = (props.severity as 'info' | 'success' | 'warning' | 'danger') ?? 'info';
      const title = asString(props.title, '');
      const message = asString(data.message, '');
      const md = title ? `**${title}**\n\n${message}` : message;
      return { kind: 'markdown-card', markdown: md, severity };
    }

    case 'image': {
      // Project a single image to media-grid (size 1).
      return {
        kind: 'media-grid',
        ...(typeof props.alt === 'string' ? { title: props.alt } : {}),
        items: [
          {
            id: 'img-1',
            url: asString(data.url),
            ...(typeof props.caption === 'string'
              ? { caption: props.caption }
              : {}),
            mimeType: 'image/*',
          },
        ],
        columns: 1,
      };
    }

    case 'video': {
      // Best-effort projection — video plays in the media-grid lightbox.
      return {
        kind: 'media-grid',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        items: [
          {
            id: 'vid-1',
            url: asString(data.url),
            ...(typeof props.poster === 'string' ? { thumbUrl: props.poster } : {}),
            mimeType: asString(data.mimeType, 'video/mp4'),
          },
        ],
        columns: 1,
      };
    }

    case 'map_view': {
      const center =
        Array.isArray(props.center) && props.center.length === 2
          ? ([Number(props.center[0]), Number(props.center[1])] as const)
          : ([0, 0] as const);
      return {
        kind: 'map',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        center,
        zoom: asNumber(props.zoom, 10),
        markers: asArray(props.markers ?? data.markers) as never,
      };
    }

    case 'heatmap': {
      return {
        kind: 'heatmap',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        xAxis: asArray<string>(props.xAxis ?? data.xAxis),
        yAxis: asArray<string>(props.yAxis ?? data.yAxis),
        cells: asArray<ReadonlyArray<number>>(props.cells ?? data.cells),
        colorScale: (props.colorScale as 'linear' | 'log' | 'diverging') ?? 'linear',
        format: (props.format as 'currency' | 'percent' | 'count') ?? 'count',
        ...(typeof props.minValue === 'number' ? { minValue: props.minValue } : {}),
        ...(typeof props.maxValue === 'number' ? { maxValue: props.maxValue } : {}),
        ...(typeof props.currency === 'string' ? { currency: props.currency } : {}),
        ...(typeof props.unit === 'string' ? { unit: props.unit } : {}),
      };
    }

    case 'timeline': {
      return {
        kind: 'timeline',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        events: asArray(props.events ?? data.events) as never,
      };
    }

    case 'kanban': {
      return {
        kind: 'kanban',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        columns: asArray(props.columns ?? data.columns) as never,
      };
    }

    case 'gantt': {
      // Project to workflow steps (sequenced bars). Richer gantt is
      // tracked in TODO(#37); this projection preserves order + status.
      const bars = asArray<Record<string, unknown>>(data.bars);
      const steps: ReadonlyArray<WorkflowStep> = bars.map((bar) => ({
        label: asString(bar.label, 'Task'),
        status:
          (bar.status as 'pending' | 'running' | 'done' | 'failed') ?? 'pending',
        ...(typeof bar.start === 'string' ? { startedAt: bar.start as string } : {}),
        ...(typeof bar.end === 'string' ? { completedAt: bar.end as string } : {}),
      }));
      return {
        kind: 'workflow',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        steps,
        currentIndex: steps.findIndex((s) => s.status === 'running'),
      };
    }

    case 'workflow': {
      return {
        kind: 'workflow',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        steps: asArray(props.steps ?? data.steps) as never,
        currentIndex: asNumber(props.currentIndex, 0),
      };
    }

    case 'code_block': {
      return {
        kind: 'code-block',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        code: asString(props.code ?? data.code, ''),
        language:
          (props.language as 'sql' | 'json' | 'log' | 'text' | 'bash' | 'typescript' | 'python') ??
          'text',
        ...(typeof props.filename === 'string' ? { filename: props.filename } : {}),
        ...(Array.isArray(props.highlightLines)
          ? { highlightLines: props.highlightLines as ReadonlyArray<number> }
          : {}),
      };
    }

    case 'comparison': {
      return {
        kind: 'comparison-table',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        columns: asArray<string>(props.columns ?? data.columns),
        rows: asArray(props.rows ?? data.rows) as never,
      };
    }

    case 'sparkline': {
      return {
        kind: 'metric-sparkline',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        label: asString(props.label, 'Metric'),
        value: asNumber(props.value ?? data.value, 0),
        format: (props.format as 'currency' | 'percent' | 'number') ?? 'number',
        ...(typeof props.currency === 'string' ? { currency: props.currency } : {}),
        sparkline: asArray<number>(props.sparkline ?? data.sparkline),
        ...(typeof props.delta === 'number' ? { delta: props.delta } : {}),
        ...(typeof props.deltaIsPositive === 'boolean'
          ? { deltaIsPositive: props.deltaIsPositive }
          : {}),
      };
    }

    case 'gauge': {
      return {
        kind: 'gauge',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        value: asNumber(props.value ?? data.value, 0),
        min: asNumber(props.min, 0),
        max: asNumber(props.max, 100),
        label: asString(props.label, 'Gauge'),
        ...(props.format
          ? { format: props.format as 'percent' | 'number' | 'currency' }
          : {}),
        ...(typeof props.currency === 'string' ? { currency: props.currency } : {}),
        ...(Array.isArray(props.thresholds)
          ? { thresholds: props.thresholds as ReadonlyArray<{ value: number; color: string }> }
          : {}),
      };
    }

    case 'org_chart': {
      const root = (props.root ?? data.root) as
        | Readonly<{ id: string; label: string; children?: ReadonlyArray<unknown> }>
        | undefined;
      if (!root || typeof root !== 'object') return null;
      return {
        kind: 'org-chart',
        ...(typeof props.title === 'string' ? { title: props.title } : {}),
        root: root as never,
        ...(props.orientation
          ? { orientation: props.orientation as 'vertical' | 'horizontal' }
          : {}),
      };
    }

    default:
      return null;
  }
}
