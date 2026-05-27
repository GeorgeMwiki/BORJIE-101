'use client';

/**
 * GenUI block — picks the right viz component for an incoming
 * shape and renders it inline in chat via `@borjie/genui`'s
 * AdaptiveRenderer.
 *
 * Selection rules:
 *   - shape: 'sankey'        → SankeyView
 *   - shape: 'time-series'   → TimeSeriesWithForecast
 *   - shape: 'graph'         → engine selected by node count
 *       < 1000 nodes  → CytoscapeView
 *       < 10_000      → ReactFlowView
 *       >= 10_000     → SigmaView
 *
 * Returns a discriminator so consumers can also use it for unit-test
 * snapshots without touching the DOM.
 */

import { z } from 'zod';
import { CytoscapeView } from '../components/CytoscapeView';
import { ReactFlowView } from '../components/ReactFlowView';
import { SigmaView } from '../components/SigmaView';
import { SankeyView } from '../components/SankeyView';
import { TimeSeriesWithForecast } from '../components/TimeSeriesWithForecast';
import { EChartsGraph } from '../components/EChartsGraph';
import { ForceGraphView } from '../components/ForceGraphView';
import { selectEngineForNodeCount } from '../layouts';
import {
  GraphNodeSchema,
  GraphEdgeSchema,
  type GraphVizProps,
  type SankeyVizProps,
  type TimeSeriesWithForecastProps,
  type GraphEngine,
} from '../types';

// ─────────────────────────────────────────────────────────────────────
// Discriminated payload schema — the LLM emits one of these inline.
// Validation is performed at the GenUI layer; we re-validate inside
// the block as defense-in-depth.
// ─────────────────────────────────────────────────────────────────────

export const GraphVizBlockSchema = z.discriminatedUnion('shape', [
  z.object({
    kind: z.literal('graph-viz'),
    shape: z.literal('graph'),
    nodes: z.array(GraphNodeSchema),
    edges: z.array(GraphEdgeSchema),
    ariaLabel: z.string().min(1),
    preferGpu: z.boolean().optional(),
    themeName: z.enum(['brand-light', 'brand-dark']).optional(),
    engine: z.enum(['cytoscape', 'reactflow', 'sigma', 'vis-network', 'force-graph', 'echarts']).optional(),
  }),
  z.object({
    kind: z.literal('graph-viz'),
    shape: z.literal('sankey'),
    nodes: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      category: z.string().optional(),
      color: z.string().optional(),
    })),
    links: z.array(z.object({
      source: z.string().min(1),
      target: z.string().min(1),
      value: z.number().positive(),
      color: z.string().optional(),
    })),
    unitLabel: z.string().optional(),
    ariaLabel: z.string().min(1),
    themeName: z.enum(['brand-light', 'brand-dark']).optional(),
  }),
  z.object({
    kind: z.literal('graph-viz'),
    shape: z.literal('time-series'),
    historical: z.array(z.object({
      t: z.string().min(1),
      y: z.number().finite(),
    })),
    forecast: z.array(z.object({
      t: z.string().min(1),
      point: z.number().finite(),
      lower80: z.number().finite().optional(),
      upper80: z.number().finite().optional(),
      lower95: z.number().finite().optional(),
      upper95: z.number().finite().optional(),
    })),
    seriesName: z.string().min(1),
    unit: z.string().optional(),
    ariaLabel: z.string().min(1),
    themeName: z.enum(['brand-light', 'brand-dark']).optional(),
  }),
]);

export type GraphVizBlockPayload = z.infer<typeof GraphVizBlockSchema>;

export interface GraphVizBlockProps {
  readonly payload: GraphVizBlockPayload | Record<string, unknown>;
  readonly testId?: string;
}

/**
 * Decide which component to render for a payload. Pulled out for
 * testability — the GenUI block is otherwise pure.
 */
export function pickComponentForPayload(payload: GraphVizBlockPayload): {
  readonly component: 'sankey' | 'time-series' | GraphEngine;
} {
  if (payload.shape === 'sankey')      return { component: 'sankey' };
  if (payload.shape === 'time-series') return { component: 'time-series' };
  // graph
  if (payload.engine) return { component: payload.engine };
  const engine = selectEngineForNodeCount({
    nodeCount: payload.nodes.length,
    edgeCount: payload.edges.length,
    preferGpu: payload.preferGpu ?? false,
  });
  return { component: engine };
}

export function GraphVizBlock({ payload, testId }: GraphVizBlockProps): JSX.Element {
  const parsed = GraphVizBlockSchema.safeParse(payload);
  if (!parsed.success) {
    return (
      <div
        role="alert"
        data-graph-viz-malformed="true"
        data-testid={testId ?? 'graph-viz-block-malformed'}
        style={{ padding: 12, border: '1px dashed #B8873E', borderRadius: 8, color: '#6E5028' }}
      >
        graph-viz: malformed payload — {parsed.error.issues[0]?.message ?? 'invalid'}
      </div>
    );
  }
  const value = parsed.data;
  const picked = pickComponentForPayload(value);

  if (value.shape === 'sankey') {
    const sankeyProps: SankeyVizProps = {
      nodes: value.nodes,
      links: value.links,
      ariaLabel: value.ariaLabel,
      ...(value.themeName ? { themeName: value.themeName } : {}),
      ...(value.unitLabel ? { unitLabel: value.unitLabel } : {}),
      ...(testId ? { testId } : {}),
    };
    return <SankeyView {...sankeyProps} />;
  }

  if (value.shape === 'time-series') {
    const tsProps: TimeSeriesWithForecastProps = {
      historical: value.historical,
      forecast: value.forecast,
      seriesName: value.seriesName,
      ariaLabel: value.ariaLabel,
      ...(value.unit ? { unit: value.unit } : {}),
      ...(value.themeName ? { themeName: value.themeName } : {}),
      ...(testId ? { testId } : {}),
    };
    return <TimeSeriesWithForecast {...tsProps} />;
  }

  // shape === 'graph'
  const graphProps: GraphVizProps = {
    nodes: value.nodes,
    edges: value.edges,
    ariaLabel: value.ariaLabel,
    ...(value.themeName ? { themeName: value.themeName } : {}),
    ...(testId ? { testId } : {}),
  };

  switch (picked.component) {
    case 'cytoscape':   return <CytoscapeView {...graphProps} />;
    case 'reactflow':   return <ReactFlowView {...graphProps} />;
    case 'sigma':       return <SigmaView {...graphProps} />;
    case 'echarts':     return <EChartsGraph {...graphProps} />;
    case 'force-graph': return <ForceGraphView {...graphProps} />;
    case 'vis-network':
    default:            return <CytoscapeView {...graphProps} />;
  }
}
