/**
 * Kernel tools — barrel.
 *
 * Re-exports the four Neo4j-backed graph kernel tools, the bundle
 * factory, and the market-data tools (Zillow / Airbnb / future external
 * providers behind the duck-typed MarketDataPort). Wired into the kernel
 * namespace via packages/central-intelligence/src/kernel/index.ts so
 * callers compose with `import { tools } from '@borjie/central-intelligence'`.
 */

export {
  createPortfolioConcentrationTool,
  createConnectedPartiesTool,
  createLeaseNetworkTool,
  createVacancyClustersTool,
  createGraphKernelTools,
  type GraphReadClient,
  type GraphToolDeps,
  type GraphKernelToolBundle,
  type ConcentrationFlag,
  type PortfolioConcentrationInput,
  type PortfolioConcentrationOutput,
  type ConnectedPartiesInput,
  type ConnectedPartiesOutput,
  type LeaseNetworkInput,
  type LeaseNetworkOutput,
  type VacancyClustersInput,
  type VacancyClustersOutput,
} from './graph-tools.js';

// External market-data kernel tools — wraps a duck-typed MarketDataPort
// (concrete impl supplied by @borjie/market-intelligence at the
// composition root) into agent-loop callable tools. Two tools:
//   - market.comparable_rents
//   - market.vacancy_trends
export {
  createMarketComparableRentsTool,
  createMarketVacancyTrendsTool,
  createMarketDataKernelTools,
  createMarketDataTool,
  type MarketDataPortShape,
  type MarketDataOutcomeShape,
  type MarketDataToolDeps,
  type MarketDataKernelToolBundle,
  type MarketComparableRent,
  type MarketVacancyTrend,
  type ComparableRentsInput,
  type ComparableRentsOutput,
  type VacancyTrendsInput,
  type VacancyTrendsOutput,
} from './market-data-tool.js';

// World-model kernel tools — forward-simulate property / tenant /
// agency state vectors so the brain can reason about trajectories,
// not just snapshots. Three tools:
//   - world.property_trajectory
//   - world.arrears_trajectory
//   - world.market_regime
// The composition root binds historical-state fetchers (Drizzle /
// repository readers) at runtime; tests pass mocked fetchers.
export {
  createPropertyTrajectoryTool,
  createArrearsTrajectoryTool,
  createMarketRegimeTool,
  createWorldModelKernelTools,
  type PropertyTrajectoryInput,
  type ArrearsTrajectoryInput,
  type MarketRegimeInput,
  type PropertyTrajectoryToolDeps,
  type ArrearsTrajectoryToolDeps,
  type MarketRegimeToolDeps,
  type WorldModelToolDeps,
  type WorldModelKernelToolBundle,
} from '../world-model/world-model-tool.js';

// Render-block kernel tools — 10 server-side wrappers that emit
// typed AG-UI UiParts (chart-vega, data-table, timeline, kpi-grid,
// prefill-form, approval, workflow, map, calendar, file-preview).
// Wired into the BrainToolRegistry alongside HQ tools so the brain
// can call e.g. `render-blocks.chart-vega({ spec, data })` to render
// generative UI in the admin-web Jarvis console.
//
// IMPORTANT name-clash note: the canonical `AgUiUiPart`,
// `AgUiUiPartKind`, `MapMarker`, `KpiTile`, etc. types are owned by
// C1's `kernel/streaming/ag-ui-types.ts`. C3's render-block module
// uses RICHER, render-oriented payload shapes (e.g. `MapPart.center`
// + `zoom`) that are intentionally distinct from C1's leaner
// transport-layer types. To avoid duplicate-export errors at the
// kernel barrel we ONLY re-export the tool factories + schemas, and
// expose the render-block payload types via the deep import path
// `@borjie/central-intelligence/kernel/tools/render-blocks`.
//
// Anti-patterns enforced inside the bundle:
//   - LLM emits values only — schemas are server-owned (Zod)
//   - chart-vega specs are ajv-validated before render
//   - prefill-form actions POST to api-gateway, not the agent
//   - LLM never emits raw JSX / Tailwind classnames
export {
  renderChartVegaTool,
  renderDataTableTool,
  renderTimelineTool,
  renderKpiGridTool,
  renderPrefillFormTool,
  renderApprovalTool,
  renderWorkflowTool,
  renderMapTool,
  renderCalendarTool,
  renderFilePreviewTool,
  createRenderBlockTools,
  createRenderBlockTool,
  validateVegaSpec,
  AgUiUiPartSchema,
  PART_SCHEMAS,
  type RenderBlockToolBundle,
  type VegaSpecValidation,
  type VegaLiteSpec,
  type DataTableColumn,
  type AnyAgUiUiPart,
  type PartKind,
  type ChartVegaPart,
  type DataTablePart,
  type TimelinePart,
  type KpiGridPart,
  type PrefillFormPart,
  type ApprovalPart,
  type WorkflowPart,
  type MapPart,
  type CalendarPart,
  type FilePreviewPart,
} from './render-blocks/index.js';
