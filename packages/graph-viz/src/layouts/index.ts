/**
 * Layouts barrel + the canonical engine-picker.
 *
 * Engine selection rule of thumb (sources cited in the spec
 * `Docs/DESIGN/GRAPH_VIZ_SOTA_2026.md`):
 *
 *   < 100 nodes        → cytoscape + cose         (richest interaction)
 *   100 - 1_000        → cytoscape + dagre/cose   (still SVG-fast)
 *   1_000 - 10_000     → reactflow OR sigma       (canvas/WebGL needed)
 *   > 10_000           → sigma (WebGL)            (only GPU survives)
 *
 * Sankeys never reach the chooser; the GenUI block routes shape-first.
 */

import type { Layout, LayoutName, GraphEngine, EngineSelectionHint } from '../types';
import { BREADTHFIRST_LAYOUT } from './breadthfirst';
import { COSE_LAYOUT } from './cose';
import { DAGRE_LAYOUT } from './dagre';
import { GRID_LAYOUT } from './grid';
import { RADIAL_LAYOUT } from './radial';

export { BREADTHFIRST_LAYOUT, COSE_LAYOUT, DAGRE_LAYOUT, GRID_LAYOUT, RADIAL_LAYOUT };

export const LAYOUT_REGISTRY: Readonly<Record<LayoutName, Layout>> = {
  breadthfirst: BREADTHFIRST_LAYOUT,
  cose:         COSE_LAYOUT,
  dagre:        DAGRE_LAYOUT,
  grid:         GRID_LAYOUT,
  radial:       RADIAL_LAYOUT,
  circle:       { ...RADIAL_LAYOUT, name: 'circle' },
  force:        { ...COSE_LAYOUT,   name: 'force' },
  preset:       { name: 'preset', animate: false, options: {} },
} as const;

/**
 * Pick the best engine for a graph given size and intent.
 *
 * Performance bands (validated 2025-12 against Cosmograph benchmarks,
 * https://cosmograph.app/blog/benchmarks):
 *   - Cytoscape SVG: smooth pan/zoom up to ~1500 nodes.
 *   - react-flow 12 canvas-light: smooth to ~5000 nodes.
 *   - sigma 3 WebGL: 100_000+ nodes at 60fps on a 2024 M3.
 */
export function selectEngineForNodeCount(
  hint: EngineSelectionHint,
): GraphEngine {
  if (hint.isSankey)     return 'echarts';
  if (hint.isTimeSeries) return 'echarts';
  if (hint.nodeCount > 10_000) return 'sigma';
  if (hint.preferGpu && hint.nodeCount > 1_000) return 'sigma';
  if (hint.nodeCount > 1_000)  return 'reactflow';
  return 'cytoscape';
}

/**
 * Pick the layout that pairs with the chosen engine for a node count.
 * Returns a layout *name* — adapters resolve to the registry on mount.
 */
export function selectLayoutForNodeCount(nodeCount: number): LayoutName {
  if (nodeCount < 100)         return 'cose';
  if (nodeCount < 1_000)       return 'dagre';
  if (nodeCount < 10_000)      return 'cose';
  return 'force';
}
