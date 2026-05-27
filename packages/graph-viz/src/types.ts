/**
 * @borjie/graph-viz — public types.
 *
 * Pure contracts only. No runtime. Every interactive viz primitive in
 * this package speaks these shapes so consumers can swap engines
 * (Cytoscape ⇄ react-flow ⇄ sigma ⇄ vis-network) without touching the
 * data layer.
 *
 * Design intent (Mr. Mwikila persona — mining-domain auditor): every
 * visualisation MUST round-trip an immutable input. We never mutate
 * the array of nodes / edges. Style is *derived* from `NodeStyle`
 * presets, not embedded in the data.
 */

import { z } from 'zod';
import type { ReactNode } from 'react';

// ─────────────────────────────────────────────────────────────────────
// Core graph primitives — engine-agnostic.
// Every adapter (CytoscapeView, ReactFlowView, SigmaView, …) consumes
// these and projects them into the underlying library's native shape.
// ─────────────────────────────────────────────────────────────────────

export interface GraphNode {
  readonly id: string;
  readonly label?: string;
  /** Free-form domain category: 'licence', 'concession', 'royalty-payer', etc. */
  readonly kind?: string;
  /** Optional override; otherwise the engine picks from the theme. */
  readonly style?: NodeStyle;
  /** Engine-agnostic position hint. Layouts may override. */
  readonly position?: { readonly x: number; readonly y: number };
  /** Arbitrary domain payload — never mutated by the viz layer. */
  readonly data?: Readonly<Record<string, unknown>>;
}

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  kind: z.string().optional(),
  position: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }).optional(),
  data: z.record(z.unknown()).optional(),
});

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly kind?: string;
  readonly weight?: number;
  readonly directed?: boolean;
  readonly style?: EdgeStyle;
  readonly data?: Readonly<Record<string, unknown>>;
}

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional(),
  kind: z.string().optional(),
  weight: z.number().finite().optional(),
  directed: z.boolean().optional(),
  data: z.record(z.unknown()).optional(),
});

// ─────────────────────────────────────────────────────────────────────
// Style tokens — engine-agnostic. Every color is an OKLCH-derived
// token reference (see `themes/oklch-brand-theme.ts`) so the brand
// palette is the single source of truth.
// ─────────────────────────────────────────────────────────────────────

export interface NodeStyle {
  /** CSS color (already OKLCH or hex) — no hue token strings. */
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly radius?: number;
  readonly opacity?: number;
  readonly labelColor?: string;
  readonly labelSize?: number;
  /** One of: 'ellipse', 'rectangle', 'round-rectangle', 'diamond', 'hexagon'. */
  readonly shape?: NodeShape;
}

export const NODE_SHAPES = [
  'ellipse',
  'rectangle',
  'round-rectangle',
  'diamond',
  'hexagon',
] as const;
export type NodeShape = (typeof NODE_SHAPES)[number];

export interface EdgeStyle {
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly dasharray?: string;
  readonly labelColor?: string;
  readonly labelSize?: number;
  /** 'solid' is the only non-degenerate value here; reserve for future. */
  readonly variant?: 'solid' | 'dashed' | 'dotted';
}

// ─────────────────────────────────────────────────────────────────────
// Layouts — each engine implements its own physics, but the picked
// name is engine-agnostic and gets mapped per adapter.
// ─────────────────────────────────────────────────────────────────────

export const LAYOUT_NAMES = [
  'breadthfirst',
  'cose',
  'dagre',
  'grid',
  'radial',
  'circle',
  'force',
  'preset',
] as const;
export type LayoutName = (typeof LAYOUT_NAMES)[number];

export interface Layout {
  readonly name: LayoutName;
  /** Optional per-layout tuning bag (kept opaque to the data layer). */
  readonly options?: Readonly<Record<string, unknown>>;
  /** Default true; set false for deterministic renders in tests. */
  readonly animate?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Viewport — pan/zoom/fit hints shared across engines.
// ─────────────────────────────────────────────────────────────────────

export interface Viewport {
  readonly zoom?: number;
  readonly pan?: { readonly x: number; readonly y: number };
  /** If true the engine fits all nodes on mount. */
  readonly fit?: boolean;
  readonly minZoom?: number;
  readonly maxZoom?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Engine selection.
// ─────────────────────────────────────────────────────────────────────

export const GRAPH_ENGINES = [
  'cytoscape',
  'reactflow',
  'sigma',
  'vis-network',
  'force-graph',
  'echarts',
] as const;
export type GraphEngine = (typeof GRAPH_ENGINES)[number];

// ─────────────────────────────────────────────────────────────────────
// GraphVizProps — the canonical input every wrapper accepts.
// Mining-domain wrappers extend this with extra props.
// ─────────────────────────────────────────────────────────────────────

export interface GraphVizProps {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges: ReadonlyArray<GraphEdge>;
  readonly layout?: Layout;
  readonly viewport?: Viewport;
  /** Container height. Px or any valid CSS dimension. Default 480px. */
  readonly height?: number | string;
  readonly width?: number | string;
  /** Default theme is brand. */
  readonly themeName?: 'brand-light' | 'brand-dark';
  /** Selected node id (controlled). */
  readonly selectedNodeId?: string;
  /** Click handler — receives engine-agnostic node id. */
  readonly onNodeSelect?: (nodeId: string) => void;
  /** Hover handler. */
  readonly onNodeHover?: (nodeId: string | null) => void;
  /** ARIA label for the canvas region. WCAG 2.2 AA requires one. */
  readonly ariaLabel: string;
  /** Optional caption / empty-state content. */
  readonly emptyState?: ReactNode;
  /** Stable test hook id. */
  readonly testId?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Sankey-specific shape — the wrapped d3-sankey contract is wider
// than a directed-graph but compatible (every Sankey is a DAG).
// ─────────────────────────────────────────────────────────────────────

export interface SankeyNode {
  readonly id: string;
  readonly name: string;
  readonly category?: string;
  readonly color?: string;
}

export interface SankeyLink {
  readonly source: string;
  readonly target: string;
  /** Positive flow weight in the unit of measure (e.g. tonnes, TZS). */
  readonly value: number;
  readonly color?: string;
}

export interface SankeyVizProps {
  readonly nodes: ReadonlyArray<SankeyNode>;
  readonly links: ReadonlyArray<SankeyLink>;
  readonly height?: number;
  readonly width?: number;
  readonly themeName?: 'brand-light' | 'brand-dark';
  readonly unitLabel?: string;
  readonly ariaLabel: string;
  readonly testId?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Time-series with forecast — accepts a ForecastResult shape from
// `@borjie/forecasting`. The wrapper does NOT depend on the
// forecasting package at type-level (peer dep) so we re-declare the
// MINIMUM shape we need. The shape is a strict subset of
// `TimeSeriesForecast` from the upstream package.
// ─────────────────────────────────────────────────────────────────────

export interface ForecastSeriesPoint {
  readonly t: string;
  readonly y: number;
}

export interface ForecastIntervalPoint {
  readonly t: string;
  readonly point: number;
  readonly lower80?: number;
  readonly upper80?: number;
  readonly lower95?: number;
  readonly upper95?: number;
}

export interface TimeSeriesWithForecastProps {
  readonly historical: ReadonlyArray<ForecastSeriesPoint>;
  readonly forecast: ReadonlyArray<ForecastIntervalPoint>;
  readonly seriesName: string;
  readonly unit?: string;
  readonly height?: number;
  readonly width?: number;
  readonly themeName?: 'brand-light' | 'brand-dark';
  readonly ariaLabel: string;
  readonly testId?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Engine-selection helper input — used by `selectEngineForNodeCount`
// and the GenUI block dispatcher.
// ─────────────────────────────────────────────────────────────────────

export interface EngineSelectionHint {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly preferGpu?: boolean;
  readonly isSankey?: boolean;
  readonly isTimeSeries?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Mining-domain payloads — Mr. Mwikila's vocabulary. Used by the
// wrappers in `domain/mining-vizzes.tsx`.
// ─────────────────────────────────────────────────────────────────────

export interface MiningLicence {
  readonly licenceId: string;
  readonly holder: string;
  readonly mineral: string;
  readonly jurisdiction: string;
  readonly status: 'active' | 'pending' | 'lapsed' | 'revoked';
}

export interface MiningLicenceRelationship {
  readonly source: string;
  readonly target: string;
  readonly relation: 'subsidiary' | 'joint-venture' | 'royalty-payer' | 'transporter' | 'buyer';
}

export interface SupplyChainStage {
  readonly id: string;
  readonly stage: 'extraction' | 'haulage' | 'beneficiation' | 'smelter' | 'export' | 'buyer';
  readonly name: string;
}

export interface SupplyChainFlow {
  readonly source: string;
  readonly target: string;
  /** Tonnes per period (or whatever the unitLabel says). */
  readonly tonnes: number;
}

export interface WorkerShift {
  readonly workerId: string;
  readonly workerName: string;
  readonly start: string;
  readonly end: string;
  readonly role: string;
  readonly status: 'planned' | 'in-progress' | 'completed' | 'absent';
}

export interface RoyaltyFlow {
  readonly source: string;
  readonly target: string;
  /** Royalty amount in minor currency units (e.g. TZS cents). */
  readonly amount: number;
  readonly currency: string;
}

export interface MineralPriceHistory {
  readonly mineral: string;
  readonly unit: 'USD/oz' | 'USD/tonne' | 'USD/lb' | 'USD/g';
  readonly historical: ReadonlyArray<ForecastSeriesPoint>;
  readonly forecast: ReadonlyArray<ForecastIntervalPoint>;
}
