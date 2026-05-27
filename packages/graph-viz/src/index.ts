/**
 * @borjie/graph-viz — public barrel.
 *
 * SOTA interactive graph + chart visualisation primitives that
 * integrate with `@borjie/genui`'s AdaptiveRenderer so the Jarvis
 * brain can drop a graph block inline in chat. The mining-domain
 * wrappers expose Mr. Mwikila's vocabulary (licence relationships,
 * supply-chain flows, worker shifts, royalty flows, mineral prices)
 * on top of the engine-agnostic core.
 *
 * Spec: `Docs/DESIGN/GRAPH_VIZ_SOTA_2026.md`.
 */

// Types — engine-agnostic core
export type {
  GraphNode,
  GraphEdge,
  NodeStyle,
  EdgeStyle,
  NodeShape,
  Layout,
  LayoutName,
  Viewport,
  GraphEngine,
  GraphVizProps,
  SankeyNode,
  SankeyLink,
  SankeyVizProps,
  ForecastSeriesPoint,
  ForecastIntervalPoint,
  TimeSeriesWithForecastProps,
  EngineSelectionHint,
  // Mining-domain payloads
  MiningLicence,
  MiningLicenceRelationship,
  SupplyChainStage,
  SupplyChainFlow,
  WorkerShift,
  RoyaltyFlow,
  MineralPriceHistory,
} from './types';

export {
  GraphNodeSchema,
  GraphEdgeSchema,
  NODE_SHAPES,
  LAYOUT_NAMES,
  GRAPH_ENGINES,
} from './types';

// Themes
export {
  BRAND_LIGHT_THEME,
  BRAND_DARK_THEME,
  getBrandTheme,
  pickCategoricalColor,
  isValidThemeColor,
  type OklchSwatch,
  type OklchBrandTheme,
  type BrandThemeName,
} from './themes/oklch-brand-theme';

// Layouts + selection helpers
export {
  LAYOUT_REGISTRY,
  BREADTHFIRST_LAYOUT,
  COSE_LAYOUT,
  DAGRE_LAYOUT,
  GRID_LAYOUT,
  RADIAL_LAYOUT,
  selectEngineForNodeCount,
  selectLayoutForNodeCount,
} from './layouts';

// Engine wrappers
export { ClientOnly } from './components/ClientOnly';
export { CytoscapeView } from './components/CytoscapeView';
export { ReactFlowView } from './components/ReactFlowView';
export { SigmaView } from './components/SigmaView';
export { SankeyView } from './components/SankeyView';
export { ForceGraphView } from './components/ForceGraphView';
export { EChartsGraph } from './components/EChartsGraph';
export { TimeSeriesWithForecast } from './components/TimeSeriesWithForecast';

// GenUI block + dispatch helpers
export {
  GraphVizBlock,
  GraphVizBlockSchema,
  pickComponentForPayload,
  type GraphVizBlockPayload,
  type GraphVizBlockProps,
} from './genui-blocks/graph-viz-block';

// Mining-domain wrappers (Mr. Mwikila persona)
export {
  MR_MWIKILA_PERSONA,
  LicenceRelationshipGraph,
  SupplyChainSankey,
  WorkerShiftGantt,
  RoyaltyFlowSankey,
  MineralPriceWithForecast,
  buildLicenceGraphProps,
  buildSupplyChainSankeyProps,
  buildGanttRows,
  buildRoyaltySankeyProps,
  type LicenceRelationshipGraphProps,
  type SupplyChainSankeyProps,
  type WorkerShiftGanttProps,
  type RoyaltyFlowSankeyProps,
  type MineralPriceWithForecastProps,
} from './domain/mining-vizzes';
