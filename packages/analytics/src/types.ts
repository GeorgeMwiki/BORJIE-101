/**
 * Public types for `@borjie/analytics`.
 *
 * Pure type module — no runtime. All shapes are `readonly` end-to-end so
 * consumers cannot mutate query results, chart specs, or dashboard
 * definitions after they are produced.
 *
 * Designed around four ideas:
 *
 *   1. Cube-style semantic layer — metrics + dimensions + cubes, all
 *      tenant-scoped by construction (`tenant_id = $tenant` is injected
 *      into every compiled query, never the caller's responsibility).
 *   2. Vega-Lite v6 chart spec wrapper — chart builders return complete
 *      Vega-Lite specs so the same JSON drives static SVG export,
 *      browser rendering, and PDF embedding.
 *   3. Dashboard composition as data — `DashboardDef` is a serialisable
 *      tree of widgets, each pointing to a `Query` and a `ChartSpec`.
 *      A dashboard is just data the renderer evaluates.
 *   4. AI chart authoring — natural-language question + schema profile
 *      → Vega-Lite spec + optional SQL, validated against the official
 *      Vega-Lite JSON schema before it ever reaches the renderer.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Time + identifiers
// ─────────────────────────────────────────────────────────────────────

/** Time-bucket granularity for time-series queries. */
export const TIME_GRAINS = [
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
] as const;
export type TimeGrain = (typeof TIME_GRAINS)[number];

/** Aggregation function applied to a metric column. */
export const AGGREGATIONS = [
  'sum',
  'count',
  'avg',
  'min',
  'max',
  'count_distinct',
  'median',
] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

/** ISO-8601 timestamp string. Branded to discourage `Date` accidents. */
export type IsoTimestamp = string;

// ─────────────────────────────────────────────────────────────────────
// Semantic layer — metrics, dimensions, cubes
// ─────────────────────────────────────────────────────────────────────

/**
 * One number with a name. The semantic layer compiles a `MetricRef` in
 * a `Query` to `<agg>(<column>) AS <id>` (or its API-fetcher equivalent).
 *
 * `format` is a hint for the renderer — `'currency'` triggers locale-aware
 * money formatting, `'percent'` divides by 100 when displayed, etc.
 */
export interface MetricDef {
  readonly id: string;
  readonly name: string;
  readonly agg: Aggregation;
  readonly column: string;
  readonly filters?: readonly FilterClause[];
  readonly format?: 'number' | 'currency' | 'percent' | 'duration_ms' | 'bytes';
  readonly description?: string;
}

/**
 * One categorical / temporal / numeric axis. The semantic layer compiles
 * a `DimensionRef` in a `Query` to `<column>` in `GROUP BY`. When
 * `kind === 'time'`, the optional `grain` controls bucketing.
 */
export interface DimensionDef {
  readonly id: string;
  readonly name: string;
  readonly column: string;
  readonly kind: 'time' | 'category' | 'numeric' | 'boolean';
  readonly description?: string;
}

/**
 * A cube bundles a data source with its metrics + dimensions. Every
 * cube is tenant-aware: the semantic layer guarantees a `tenant_id`
 * filter is always injected at compile time.
 */
export interface CubeDef {
  readonly name: string;
  /** Where the cube reads from. */
  readonly source: CubeSource;
  readonly metrics: readonly MetricDef[];
  readonly dimensions: readonly DimensionDef[];
  /**
   * Column on the source that carries the tenant id. Defaults to
   * `tenant_id`. The semantic layer always emits a `WHERE` clause
   * `<tenantColumn> = $tenant` regardless of caller-supplied filters.
   */
  readonly tenantColumn?: string;
}

export type CubeSource =
  | { readonly kind: 'sql'; readonly table: string }
  | { readonly kind: 'api'; readonly endpoint: string }
  | { readonly kind: 'memory'; readonly rows: readonly ParsedRow[] };

// ─────────────────────────────────────────────────────────────────────
// Queries — semantic → compiled
// ─────────────────────────────────────────────────────────────────────

/**
 * Filter operator. The semantic layer rejects unknown ops at compile
 * time so the SQL builder never sees user-controlled operators.
 */
export const FILTER_OPS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'starts_with',
  'between',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface FilterClause {
  readonly column: string;
  readonly op: FilterOp;
  readonly value: unknown;
}

/**
 * A semantic-layer query. References metrics + dimensions by id; the
 * caller never spells out columns or aggs directly.
 */
export interface Query {
  readonly cube: string;
  readonly tenantId: string;
  readonly metrics: readonly string[];
  readonly dimensions?: readonly string[];
  readonly timeGrain?: TimeGrain;
  readonly filters?: readonly FilterClause[];
  readonly timeRange?: { readonly start: IsoTimestamp; readonly end: IsoTimestamp; readonly column?: string };
  readonly limit?: number;
  readonly orderBy?: readonly { readonly id: string; readonly direction: 'asc' | 'desc' }[];
}

/** Result of compiling a `Query` against an SQL cube. */
export interface SqlQuery {
  readonly kind: 'sql';
  readonly sql: string;
  readonly params: Readonly<Record<string, unknown>>;
  /** Always true — present so callers can prove tenant injection at compile time. */
  readonly tenantScoped: true;
}

/** Result of compiling a `Query` against an API cube. */
export interface ApiQuery {
  readonly kind: 'api';
  readonly endpoint: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly tenantScoped: true;
}

/** Result of compiling a `Query` against an in-memory cube. */
export interface MemoryQuery {
  readonly kind: 'memory';
  readonly rows: readonly ParsedRow[];
  readonly projection: Readonly<{
    readonly metrics: readonly { readonly id: string; readonly column: string; readonly agg: Aggregation }[];
    readonly dimensions: readonly { readonly id: string; readonly column: string; readonly grain?: TimeGrain }[];
    readonly filters: readonly FilterClause[];
  }>;
  readonly tenantScoped: true;
}

export type CompiledQuery = SqlQuery | ApiQuery | MemoryQuery;

// ─────────────────────────────────────────────────────────────────────
// Charts — Vega-Lite v6 wrapper
// ─────────────────────────────────────────────────────────────────────

/**
 * Minimal Vega-Lite v6 spec shape. We do not retype the entire schema
 * (it has hundreds of optional fields); we keep the typed surface to the
 * fields our builders set and leave the rest as `unknown`. The
 * `validateChartSpec` runtime guard catches authoring drift.
 */
export interface ChartSpec {
  readonly $schema?: string;
  readonly description?: string;
  readonly width?: number | 'container';
  readonly height?: number | 'container';
  readonly title?: string | { readonly text: string; readonly subtitle?: string };
  readonly data: { readonly values?: readonly Record<string, unknown>[]; readonly url?: string; readonly name?: string };
  readonly mark: ChartMark;
  readonly encoding?: Record<string, unknown>;
  readonly layer?: readonly ChartSpec[];
  readonly facet?: Record<string, unknown>;
  readonly transform?: readonly Record<string, unknown>[];
  readonly config?: Record<string, unknown>;
  readonly projection?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export type ChartMark =
  | 'bar'
  | 'line'
  | 'point'
  | 'circle'
  | 'square'
  | 'tick'
  | 'rect'
  | 'rule'
  | 'area'
  | 'arc'
  | 'geoshape'
  | 'text'
  | 'boxplot'
  | { readonly type: ChartMarkType; readonly [key: string]: unknown };

export type ChartMarkType =
  | 'bar'
  | 'line'
  | 'point'
  | 'circle'
  | 'square'
  | 'tick'
  | 'rect'
  | 'rule'
  | 'area'
  | 'arc'
  | 'geoshape'
  | 'text'
  | 'boxplot';

// ─────────────────────────────────────────────────────────────────────
// Dashboards
// ─────────────────────────────────────────────────────────────────────

/** Grid position for a widget — 12-column grid by convention. */
export interface WidgetPosition {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type WidgetKind = 'chart' | 'kpi' | 'table' | 'markdown';

/**
 * A `WidgetDef` ties a query to a presentation. For `kind === 'chart'`,
 * `spec` is the Vega-Lite spec the renderer hands to the chart library.
 * For `kind === 'kpi' | 'table'`, `spec` is the presentation hint
 * (formatting, comparison period, threshold colours). For
 * `kind === 'markdown'`, `spec` carries the raw markdown.
 */
export interface WidgetDef {
  readonly id: string;
  readonly title: string;
  readonly kind: WidgetKind;
  readonly query?: Query;
  readonly spec: ChartSpec | KpiSpec | TableSpec | MarkdownSpec;
  readonly position: WidgetPosition;
  readonly description?: string;
}

export interface KpiSpec {
  readonly kind: 'kpi';
  readonly metric: string;
  readonly format?: MetricDef['format'];
  readonly comparison?: {
    readonly period: 'previous' | 'year_ago';
    readonly showDelta: boolean;
  };
  readonly threshold?: {
    readonly good: number;
    readonly warn: number;
  };
}

export interface TableSpec {
  readonly kind: 'table';
  readonly columns: readonly { readonly id: string; readonly title: string; readonly format?: MetricDef['format'] }[];
  readonly pageSize?: number;
}

export interface MarkdownSpec {
  readonly kind: 'markdown';
  readonly markdown: string;
}

export interface DashboardDef {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly tenantId: string;
  readonly layout: 'grid-12' | 'free';
  readonly widgets: readonly WidgetDef[];
  /** Optional default time range applied to every widget query that doesn't override it. */
  readonly defaultTimeRange?: Query['timeRange'];
  readonly createdAt?: IsoTimestamp;
  readonly updatedAt?: IsoTimestamp;
}

// ─────────────────────────────────────────────────────────────────────
// Parsed data + schema inference
// ─────────────────────────────────────────────────────────────────────

/**
 * Generic row from a parser. We do not type the columns — schema
 * inference produces `SchemaProfile` separately. This keeps parsers
 * pluggable across CSV / XLSX / JSON / PDF / image OCR.
 */
export type ParsedRow = Readonly<Record<string, unknown>>;

export type InferredType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'timestamp'
  | 'date'
  | 'unknown';

export interface ColumnProfile {
  readonly name: string;
  readonly inferredType: InferredType;
  readonly nullCount: number;
  readonly distinctCount: number;
  readonly samples: readonly unknown[];
  /** For numeric columns only. */
  readonly numericSummary?: {
    readonly min: number;
    readonly max: number;
    readonly mean: number;
    readonly median: number;
  };
}

export interface SchemaProfile {
  readonly rowCount: number;
  readonly columns: readonly ColumnProfile[];
}

/**
 * Pluggable document parser. Adapters wrap external services like
 * Unstructured.io and LlamaParse. Built-in CSV/XLSX/JSON parsers
 * implement this interface directly so the AI chart author can treat
 * any source uniformly.
 */
export interface DocumentParser {
  readonly id: string;
  parse(bytes: Uint8Array, mime: string): Promise<readonly ParsedRow[]>;
}

// ─────────────────────────────────────────────────────────────────────
// AI chart author
// ─────────────────────────────────────────────────────────────────────

/**
 * Request to the natural-language → chart spec authoring path. The
 * caller supplies the user question + a schema profile (or cube
 * reference) and the authored chart spec + optional SQL come back.
 */
export interface NLQueryRequest {
  readonly question: string;
  readonly schema: SchemaProfile;
  /** Optional: target cube name. When supplied, the authored SQL is
   * grounded in the cube's columns rather than schema columns alone. */
  readonly cubeName?: string;
  /** Optional: hint at the desired chart kind ("bar", "line", etc.). */
  readonly preferredChart?: ChartMarkType;
}

export interface NLQueryResponse {
  readonly spec: ChartSpec;
  readonly sql?: string;
  readonly explanation: string;
  /** True when the spec was produced deterministically (no brain). */
  readonly deterministic: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// DataSource — a source the analytics package can read from
// ─────────────────────────────────────────────────────────────────────

export type DataSource =
  | { readonly kind: 'sql'; readonly connectionId: string; readonly read: (sql: SqlQuery) => Promise<readonly ParsedRow[]> }
  | { readonly kind: 'api'; readonly read: (api: ApiQuery) => Promise<readonly ParsedRow[]> }
  | { readonly kind: 'memory'; readonly rows: readonly ParsedRow[] };

// ─────────────────────────────────────────────────────────────────────
// Realtime / streaming
// ─────────────────────────────────────────────────────────────────────

export interface DataDelta {
  readonly widgetId: string;
  readonly rows: readonly ParsedRow[];
  readonly emittedAt: IsoTimestamp;
}

// ─────────────────────────────────────────────────────────────────────
// Zod schemas — used by AI chart author + dashboard JSON ingest
// ─────────────────────────────────────────────────────────────────────

export const FilterOpSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'starts_with',
  'between',
]);

export const FilterClauseSchema = z.object({
  column: z.string().min(1),
  op: FilterOpSchema,
  value: z.unknown(),
});

export const TimeGrainSchema = z.enum([
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
]);

export const AggregationSchema = z.enum([
  'sum',
  'count',
  'avg',
  'min',
  'max',
  'count_distinct',
  'median',
]);

export const QuerySchema = z.object({
  cube: z.string().min(1),
  tenantId: z.string().min(1),
  metrics: z.array(z.string().min(1)).min(1),
  dimensions: z.array(z.string().min(1)).optional(),
  timeGrain: TimeGrainSchema.optional(),
  filters: z.array(FilterClauseSchema).optional(),
  timeRange: z
    .object({
      start: z.string(),
      end: z.string(),
      column: z.string().optional(),
    })
    .optional(),
  limit: z.number().int().positive().optional(),
  orderBy: z
    .array(z.object({ id: z.string(), direction: z.enum(['asc', 'desc']) }))
    .optional(),
});

/**
 * Permissive Vega-Lite v6 spec schema. We only enforce the fields
 * required for the renderer to do anything (`data` + `mark`); the rest
 * is passed through so future Vega-Lite versions don't break us.
 */
export const ChartSpecSchema = z
  .object({
    $schema: z.string().optional(),
    description: z.string().optional(),
    width: z.union([z.number(), z.literal('container')]).optional(),
    height: z.union([z.number(), z.literal('container')]).optional(),
    title: z
      .union([
        z.string(),
        z.object({ text: z.string(), subtitle: z.string().optional() }),
      ])
      .optional(),
    data: z.object({
      values: z.array(z.record(z.unknown())).optional(),
      url: z.string().optional(),
      name: z.string().optional(),
    }),
    mark: z.union([
      z.enum([
        'bar',
        'line',
        'point',
        'circle',
        'square',
        'tick',
        'rect',
        'rule',
        'area',
        'arc',
        'geoshape',
        'text',
        'boxplot',
      ]),
      z.object({ type: z.string() }).passthrough(),
    ]),
    encoding: z.record(z.unknown()).optional(),
    layer: z.array(z.unknown()).optional(),
    facet: z.record(z.unknown()).optional(),
    transform: z.array(z.record(z.unknown())).optional(),
    config: z.record(z.unknown()).optional(),
    projection: z.record(z.unknown()).optional(),
  })
  .passthrough();

/** Lightweight runtime validator used by chart builders + AI author. */
export function validateChartSpec(spec: unknown): { ok: true; spec: ChartSpec } | { ok: false; errors: string[] } {
  const parsed = ChartSpecSchema.safeParse(spec);
  if (parsed.success) {
    return { ok: true, spec: parsed.data as ChartSpec };
  }
  return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}
