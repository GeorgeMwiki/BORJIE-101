/**
 * Visualization spec-builder tests.
 */
import { describe, expect, it } from 'vitest';
import {
  forceGraphSpec,
  cytoscapeSpec,
  sigmaSpec,
  chordSpec,
  sankeySpec,
  treeMapSpec,
  colorForClass,
  DEFAULT_CLASS_COLOURS,
} from '../viz/index.js';
import { fixtureSubgraph } from './fixtures.js';

describe('colorForClass', () => {
  it('returns deterministic palette colors for known classes', () => {
    expect(colorForClass('Property')).toBe(DEFAULT_CLASS_COLOURS.Property);
    expect(colorForClass('Tenant')).toBe(DEFAULT_CLASS_COLOURS.Tenant);
  });
  it('falls back to a stable hash hue for unknown classes', () => {
    const c1 = colorForClass('CarPark');
    const c2 = colorForClass('CarPark');
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^hsl\(/);
  });
});

describe('forceGraphSpec', () => {
  it('produces nodes + links arrays sized to subgraph', () => {
    const sub = fixtureSubgraph();
    const spec = forceGraphSpec(sub);
    expect(spec.kind).toBe('forceGraph');
    const nodes = (spec.payload.nodes as ReadonlyArray<unknown>);
    const links = (spec.payload.links as ReadonlyArray<unknown>);
    expect(nodes.length).toBe(sub.nodes.length);
    expect(links.length).toBe(sub.edges.length);
  });

  it('color-codes each node according to its class', () => {
    const sub = fixtureSubgraph();
    const spec = forceGraphSpec(sub);
    const nodes = spec.payload.nodes as ReadonlyArray<{ class: string; color: string }>;
    for (const n of nodes) {
      expect(n.color).toBeDefined();
    }
  });
});

describe('cytoscapeSpec', () => {
  it('outputs cytoscape-style elements + style array', () => {
    const sub = fixtureSubgraph();
    const spec = cytoscapeSpec(sub);
    expect(spec.kind).toBe('cytoscape');
    const elements = spec.payload.elements as ReadonlyArray<{ group: string }>;
    expect(elements.filter((e) => e.group === 'nodes').length).toBe(sub.nodes.length);
    expect(elements.filter((e) => e.group === 'edges').length).toBe(sub.edges.length);
    expect(Array.isArray(spec.payload.style)).toBe(true);
  });
});

describe('sigmaSpec', () => {
  it('produces keyed nodes + edges with attributes', () => {
    const sub = fixtureSubgraph();
    const spec = sigmaSpec(sub);
    expect(spec.kind).toBe('sigma');
    const nodes = spec.payload.nodes as ReadonlyArray<{
      key: string;
      attributes: { x: number; y: number; color: string };
    }>;
    expect(nodes.length).toBe(sub.nodes.length);
    expect(nodes.every((n) => typeof n.attributes.x === 'number')).toBe(true);
    expect(nodes.every((n) => typeof n.attributes.y === 'number')).toBe(true);
    expect(nodes.every((n) => typeof n.attributes.color === 'string')).toBe(true);
  });
});

describe('chordSpec', () => {
  it('produces a square class-to-class matrix', () => {
    const sub = fixtureSubgraph();
    const spec = chordSpec(sub);
    expect(spec.kind).toBe('chord');
    const classes = spec.payload.classes as ReadonlyArray<string>;
    const matrix = spec.payload.matrix as ReadonlyArray<ReadonlyArray<number>>;
    expect(matrix.length).toBe(classes.length);
    for (const row of matrix) expect(row.length).toBe(classes.length);
  });

  it('captures hasUnit relationship in the matrix', () => {
    const sub = fixtureSubgraph();
    const spec = chordSpec(sub);
    const classes = spec.payload.classes as ReadonlyArray<string>;
    const matrix = spec.payload.matrix as ReadonlyArray<ReadonlyArray<number>>;
    const pi = classes.indexOf('Property');
    const ui = classes.indexOf('Unit');
    expect(pi).toBeGreaterThanOrEqual(0);
    expect(ui).toBeGreaterThanOrEqual(0);
    expect(matrix[pi]?.[ui]).toBeGreaterThanOrEqual(2); // 2 hasUnit edges
  });
});

describe('sankeySpec', () => {
  it('produces nodes per class + flow links between classes', () => {
    const sub = fixtureSubgraph();
    const spec = sankeySpec(sub);
    expect(spec.kind).toBe('sankey');
    const nodes = spec.payload.nodes as ReadonlyArray<{ name: string }>;
    const links = spec.payload.links as ReadonlyArray<{
      source: string;
      target: string;
      value: number;
    }>;
    const names = new Set(nodes.map((n) => n.name));
    expect(names.has('Property')).toBe(true);
    expect(names.has('Unit')).toBe(true);
    // Property -> Unit link should carry value 2 (two hasUnit edges)
    const propUnit = links.find((l) => l.source === 'Property' && l.target === 'Unit');
    expect(propUnit?.value).toBeGreaterThanOrEqual(2);
  });
});

describe('treeMapSpec', () => {
  it('groups nodes by class under a tenant root', () => {
    const sub = fixtureSubgraph();
    const spec = treeMapSpec(sub);
    expect(spec.kind).toBe('treeMap');
    const payload = spec.payload as { name: string; children: ReadonlyArray<unknown> };
    expect(payload.name).toBe(sub.tenantId);
    expect(payload.children.length).toBeGreaterThan(0);
  });
});
