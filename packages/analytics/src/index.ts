/**
 * `@borjie/analytics` — public surface.
 *
 * SOTA 2026 analytics + dashboards + AI-chart authoring.
 *
 * - Cube-style semantic layer (`defineMetric`, `defineDimension`,
 *   `defineCube`, `compileQuery`). Tenant-scoped by construction.
 * - Pluggable parsers: CSV (built-in), JSON (built-in), XLSX (port),
 *   PDF/scan via Unstructured.io + LlamaParse adapters.
 * - Vega-Lite v6 chart builders (added in subsystem 2).
 * - AI chart author — natural-language → chart spec via injectable
 *   multi-LLM brain (added in subsystem 2).
 * - Dashboard composition + SOTA templates (added in subsystem 3).
 * - Streaming bridge to `@borjie/realtime-adapter` (added in
 *   subsystem 3).
 */

// Types (re-export everything)
export * from './types.js';

// Semantic layer
export {
  defineMetric,
  defineDimension,
  defineCube,
  compileQuery,
  evaluateMemory,
  type DefineCubeInput,
  type CompileError,
} from './semantic/index.js';

// Parsers
export {
  parseCsv,
  parseJson,
  parseXlsx,
  xlsxAdapterFromSheetjs,
  createUnstructuredParser,
  createLlamaParseParser,
  createParserRegistry,
  inferSchema,
  type CsvParseOptions,
  type DocumentParserRegistry,
  type InferSchemaOptions,
  type JsonParseOptions,
  type LlamaParseAdapterConfig,
  type UnstructuredAdapterConfig,
  type XlsxAdapter,
  type XlsxParseOptions,
} from './parsers/index.js';

// Charts (Vega-Lite v6 builders)
export {
  barChart,
  boxplotChart,
  funnelChart,
  gaugeChart,
  heatmapChart,
  kpiTile,
  lineChart,
  mapChart,
  pieChart,
  sankeyChart,
  scatterChart,
  CATEGORICAL_PALETTE,
  CHART_CONFIG,
  DIVERGING_PALETTE,
  SEQUENTIAL_PALETTE,
  VEGA_LITE_V6_SCHEMA,
  type BarChartInput,
  type BoxplotChartInput,
  type BuilderCommon,
  type FunnelChartInput,
  type GaugeChartInput,
  type HeatmapChartInput,
  type KpiTileInput,
  type LineChartInput,
  type MapChartInput,
  type PieChartInput,
  type SankeyChartInput,
  type ScatterChartInput,
} from './charts/index.js';

// AI Chart Author
export {
  authorChartFromQuestion,
  brainFromSynthesizer,
  pickTemplate,
  deterministicResponse,
  type AuthorChartInput,
  type ChartAuthorBrain,
  type SynthesizerLike,
} from './ai-chart-author/index.js';

// Dashboards
export {
  composeFromTemplate,
  evaluateDashboard,
  TEMPLATE_NAMES,
  type ComposeFromTemplateParams,
  type EvaluateDashboardInput,
  type QueryFetcher,
  type RenderedDashboard,
  type RenderedWidget,
  type TemplateName,
} from './dashboards/index.js';

// Streaming
export { subscribeToWidget, type RealtimePort, type SubscribeOptions } from './streaming/index.js';

// ───────────────────────── createAnalytics factory ─────────────────────────

import type { ChartAuthorBrain } from './ai-chart-author/index.js';
import type { RealtimePort } from './streaming/index.js';

export interface CreateAnalyticsOptions {
  readonly brain?: ChartAuthorBrain;
  readonly realtime?: RealtimePort;
  /** Optional storage adapter — not currently consumed by the package
   *  but retained so the composition root can pass one through for
   *  future parsed-data caching. */
  readonly storage?: unknown;
}

export interface AnalyticsInstance {
  readonly brain: ChartAuthorBrain | undefined;
  readonly realtime: RealtimePort | undefined;
  readonly storage: unknown;
}

/**
 * Top-level factory. All subsystems are also importable directly; this
 * factory is a convenience for compositions that want one place to wire
 * the brain + realtime + storage ports.
 */
export function createAnalytics(opts: CreateAnalyticsOptions = {}): AnalyticsInstance {
  return Object.freeze({
    brain: opts.brain,
    realtime: opts.realtime,
    storage: opts.storage,
  });
}
