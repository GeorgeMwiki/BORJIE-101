/**
 * Visualization spec builders.
 *
 * Each builder takes a `Subgraph` and emits a `KGViewerSpec` ready
 * for a specific renderer:
 *
 *   - `forceGraphSpec`  → react-force-graph (3d-force-graph too)
 *   - `cytoscapeSpec`   → Cytoscape.js 3.x
 *   - `sigmaSpec`       → Sigma.js 3.x
 *   - `chordSpec`       → D3 chord layout (class-class relationships)
 *   - `sankeySpec`      → D3 sankey layout (flow through node types)
 *   - `treeMapSpec`     → D3 treemap (hierarchical node breakdown)
 *
 * Color-coded by ontology class so visualisations stay consistent
 * across the portal.
 */

import type { KGViewerSpec, Subgraph } from '../types.js';
import { colorForClass, type ClassColorMap } from './colors.js';

interface VizOptions {
  readonly palette?: ClassColorMap;
}

export function forceGraphSpec(
  subgraph: Subgraph,
  opts: VizOptions = {},
): KGViewerSpec {
  const nodes = subgraph.nodes.map((n) => ({
    id: n.id,
    name: String(n.properties.name ?? n.id),
    class: n.class,
    color: colorForClass(n.class, opts.palette),
    val: 1 + Math.log10(Object.keys(n.properties).length + 1),
  }));
  const links = subgraph.edges.map((e) => ({
    source: e.fromId,
    target: e.toId,
    label: e.label,
  }));
  return {
    kind: 'forceGraph',
    payload: { nodes, links, layout: { d3Force: 'charge' } },
  };
}

export function cytoscapeSpec(
  subgraph: Subgraph,
  opts: VizOptions = {},
): KGViewerSpec {
  const elements: Array<Record<string, unknown>> = [];
  for (const n of subgraph.nodes) {
    elements.push({
      data: {
        id: n.id,
        label: String(n.properties.name ?? n.id),
        class: n.class,
        color: colorForClass(n.class, opts.palette),
      },
      group: 'nodes',
    });
  }
  for (const e of subgraph.edges) {
    elements.push({
      data: {
        id: e.id,
        source: e.fromId,
        target: e.toId,
        label: e.label,
      },
      group: 'edges',
    });
  }
  const style = [
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)',
        label: 'data(label)',
        'font-size': '10px',
      },
    },
    {
      selector: 'edge',
      style: {
        'curve-style': 'bezier',
        'target-arrow-shape': 'triangle',
        label: 'data(label)',
        'font-size': '8px',
      },
    },
  ];
  return { kind: 'cytoscape', payload: { elements, style } };
}

export function sigmaSpec(
  subgraph: Subgraph,
  opts: VizOptions = {},
): KGViewerSpec {
  const nodes = subgraph.nodes.map((n, i) => ({
    key: n.id,
    attributes: {
      label: String(n.properties.name ?? n.id),
      class: n.class,
      color: colorForClass(n.class, opts.palette),
      size: 4 + Math.log10(Object.keys(n.properties).length + 1) * 2,
      // Deterministic pseudo-random initial layout — Sigma re-runs
      // ForceAtlas2 on top, but seeded positions speed convergence.
      x: Math.cos((i / Math.max(subgraph.nodes.length, 1)) * Math.PI * 2),
      y: Math.sin((i / Math.max(subgraph.nodes.length, 1)) * Math.PI * 2),
    },
  }));
  const edges = subgraph.edges.map((e) => ({
    key: e.id,
    source: e.fromId,
    target: e.toId,
    attributes: { label: e.label, size: 1 },
  }));
  return { kind: 'sigma', payload: { nodes, edges } };
}

export function chordSpec(
  subgraph: Subgraph,
  opts: VizOptions = {},
): KGViewerSpec {
  // Group edges by (fromClass, toClass) — chord shows class-to-class flow.
  const nodeById = new Map(subgraph.nodes.map((n) => [n.id, n]));
  const classSet = new Set<string>();
  for (const n of subgraph.nodes) classSet.add(n.class);
  const classes = Array.from(classSet).sort();
  const idx = new Map(classes.map((c, i) => [c, i]));
  const matrix: number[][] = classes.map(() => new Array<number>(classes.length).fill(0));
  for (const e of subgraph.edges) {
    const fc = nodeById.get(e.fromId)?.class;
    const tc = nodeById.get(e.toId)?.class;
    if (!fc || !tc) continue;
    const fi = idx.get(fc);
    const ti = idx.get(tc);
    if (fi === undefined || ti === undefined) continue;
    const row = matrix[fi];
    if (row) row[ti] = (row[ti] ?? 0) + 1;
  }
  const colors = classes.map((c) => colorForClass(c, opts.palette));
  return {
    kind: 'chord',
    payload: { classes, matrix, colors },
  };
}

export function sankeySpec(
  subgraph: Subgraph,
  opts: VizOptions = {},
): KGViewerSpec {
  // Sankey: each ontology class is a node, edges are flows between
  // classes weighted by the count of underlying graph edges.
  const nodeById = new Map(subgraph.nodes.map((n) => [n.id, n]));
  const classSet = new Set<string>();
  for (const n of subgraph.nodes) classSet.add(n.class);
  const sankeyNodes = Array.from(classSet)
    .sort()
    .map((c) => ({ name: c, color: colorForClass(c, opts.palette) }));
  const flowMap = new Map<string, number>();
  for (const e of subgraph.edges) {
    const fc = nodeById.get(e.fromId)?.class;
    const tc = nodeById.get(e.toId)?.class;
    if (!fc || !tc) continue;
    if (fc === tc) continue; // sankey cannot self-loop
    const key = `${fc}::${tc}`;
    flowMap.set(key, (flowMap.get(key) ?? 0) + 1);
  }
  const links = Array.from(flowMap.entries()).map(([key, value]) => {
    const [source, target] = key.split('::');
    return { source, target, value };
  });
  return { kind: 'sankey', payload: { nodes: sankeyNodes, links } };
}

export function treeMapSpec(
  subgraph: Subgraph,
  opts: VizOptions = {},
): KGViewerSpec {
  // TreeMap: hierarchical view, root → class → node.
  const classBuckets = new Map<string, ReturnType<typeof Object>[]>();
  for (const n of subgraph.nodes) {
    let arr = classBuckets.get(n.class);
    if (!arr) {
      arr = [];
      classBuckets.set(n.class, arr);
    }
    arr.push({
      name: String(n.properties.name ?? n.id),
      id: n.id,
      value: 1 + Object.keys(n.properties).length,
    });
  }
  const children = Array.from(classBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cls, leaves]) => ({
      name: cls,
      color: colorForClass(cls, opts.palette),
      children: leaves,
    }));
  return {
    kind: 'treeMap',
    payload: { name: subgraph.tenantId, children },
  };
}
