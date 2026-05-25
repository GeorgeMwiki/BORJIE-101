/**
 * Dashboard composition — `DashboardDef` is data, not code.
 *
 * The composer takes a template name + params and returns a fully
 * resolved `DashboardDef`. The evaluator runs widget queries against
 * an injectable fetcher and assembles render-ready chart specs +
 * KPI values. Both functions are pure.
 *
 * Why "dashboards as data": this is the SOTA pattern from Sigma /
 * Mode / Hex — a dashboard is a JSON document the renderer evaluates.
 * That lets us:
 *   - Round-trip a dashboard through git as a code review artifact.
 *   - Generate dashboards from natural-language requests (AI authoring).
 *   - Embed dashboards in third-party tenants via signed JSON.
 *   - Schedule a dashboard to a PDF or PNG export without re-coding.
 */

import type {
  ChartSpec,
  CompiledQuery,
  DashboardDef,
  KpiSpec,
  MarkdownSpec,
  ParsedRow,
  Query,
  TableSpec,
  WidgetDef,
} from '../types.js';

// ───────────────────────── Fetcher port ─────────────────────────

export interface QueryFetcher {
  /** Execute a compiled query and return rows. Implementations may
   *  be SQL connections, HTTP API clients, or in-memory evaluators. */
  fetch(compiled: CompiledQuery): Promise<readonly ParsedRow[]>;
}

// ───────────────────────── Evaluated shape ─────────────────────────

export interface RenderedWidget {
  readonly id: string;
  readonly title: string;
  readonly kind: WidgetDef['kind'];
  readonly position: WidgetDef['position'];
  readonly spec: ChartSpec | KpiSpec | TableSpec | MarkdownSpec;
  /** The raw rows the widget query returned. Empty array for markdown. */
  readonly rows: readonly ParsedRow[];
  /** Set when fetcher / compile failed. The widget should render an error tile. */
  readonly error?: string;
}

export interface RenderedDashboard {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly tenantId: string;
  readonly widgets: readonly RenderedWidget[];
  readonly renderedAt: string;
}

// ───────────────────────── Evaluator ─────────────────────────

export interface EvaluateDashboardInput {
  readonly definition: DashboardDef;
  readonly fetcher: QueryFetcher;
  /** Optional compile hook — callers that want to pre-compile vs. the
   *  cube layer can supply a function from `Query` → `CompiledQuery`.
   *  When omitted, the evaluator assumes widget specs already carry
   *  the data they need (the chart-spec data.values pattern). */
  readonly compile?: (query: Query) => CompiledQuery;
}

export async function evaluateDashboard(input: EvaluateDashboardInput): Promise<RenderedDashboard> {
  const { definition, fetcher, compile } = input;

  const widgets = await Promise.all(
    definition.widgets.map(async (w): Promise<RenderedWidget> => {
      if (w.kind === 'markdown') {
        return Object.freeze({
          id: w.id,
          title: w.title,
          kind: w.kind,
          position: w.position,
          spec: w.spec,
          rows: [] as readonly ParsedRow[],
        });
      }

      if (!w.query) {
        return Object.freeze({
          id: w.id,
          title: w.title,
          kind: w.kind,
          position: w.position,
          spec: w.spec,
          rows: [] as readonly ParsedRow[],
        });
      }

      try {
        let rows: readonly ParsedRow[] = [];
        if (compile) {
          const merged = mergeTimeRange(w.query, definition.defaultTimeRange);
          const compiled = compile(merged);
          rows = await fetcher.fetch(compiled);
        }
        return Object.freeze({
          id: w.id,
          title: w.title,
          kind: w.kind,
          position: w.position,
          spec: applyDataToSpec(w.spec, rows, w.kind),
          rows,
        });
      } catch (err) {
        return Object.freeze({
          id: w.id,
          title: w.title,
          kind: w.kind,
          position: w.position,
          spec: w.spec,
          rows: [] as readonly ParsedRow[],
          error: (err as Error).message,
        });
      }
    }),
  );

  return Object.freeze({
    id: definition.id,
    name: definition.name,
    ...(definition.description ? { description: definition.description } : {}),
    tenantId: definition.tenantId,
    widgets,
    renderedAt: new Date().toISOString(),
  });
}

function mergeTimeRange(query: Query, fallback: DashboardDef['defaultTimeRange']): Query {
  if (query.timeRange || !fallback) return query;
  return { ...query, timeRange: fallback };
}

function applyDataToSpec(
  spec: WidgetDef['spec'],
  rows: readonly ParsedRow[],
  kind: WidgetDef['kind'],
): WidgetDef['spec'] {
  if (kind !== 'chart') return spec;
  // For chart widgets, swap data.values with the freshly fetched rows.
  const chartSpec = spec as ChartSpec;
  return Object.freeze({
    ...chartSpec,
    data: { ...chartSpec.data, values: [...rows] },
  }) as ChartSpec;
}
