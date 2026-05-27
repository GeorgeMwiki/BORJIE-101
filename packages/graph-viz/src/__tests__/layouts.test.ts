/**
 * Layout + engine-selection unit tests.
 */

import { describe, it, expect } from 'vitest';
import {
  selectEngineForNodeCount,
  selectLayoutForNodeCount,
  LAYOUT_REGISTRY,
  COSE_LAYOUT,
  DAGRE_LAYOUT,
  BREADTHFIRST_LAYOUT,
  GRID_LAYOUT,
  RADIAL_LAYOUT,
} from '../layouts';

describe('selectEngineForNodeCount', () => {
  it('picks cytoscape for small graphs (< 100 nodes)', () => {
    expect(selectEngineForNodeCount({ nodeCount: 50, edgeCount: 80 })).toBe('cytoscape');
  });

  it('picks cytoscape for medium graphs (100 - 1000 nodes)', () => {
    expect(selectEngineForNodeCount({ nodeCount: 500, edgeCount: 1200 })).toBe('cytoscape');
  });

  it('picks reactflow for large graphs (1k - 10k nodes)', () => {
    expect(selectEngineForNodeCount({ nodeCount: 5_000, edgeCount: 12_000 })).toBe('reactflow');
  });

  it('picks sigma WebGL for very large graphs (> 10k nodes)', () => {
    expect(selectEngineForNodeCount({ nodeCount: 50_000, edgeCount: 200_000 })).toBe('sigma');
  });

  it('picks sigma when preferGpu is set and node count >= 1000', () => {
    expect(selectEngineForNodeCount({ nodeCount: 1_500, edgeCount: 3_000, preferGpu: true })).toBe('sigma');
  });

  it('routes Sankey shape to echarts even on tiny inputs', () => {
    expect(selectEngineForNodeCount({ nodeCount: 12, edgeCount: 18, isSankey: true })).toBe('echarts');
  });
});

describe('selectLayoutForNodeCount', () => {
  it('picks cose for < 100 nodes', () => {
    expect(selectLayoutForNodeCount(50)).toBe('cose');
  });
  it('picks dagre for 100 - 1000 nodes', () => {
    expect(selectLayoutForNodeCount(500)).toBe('dagre');
  });
  it('picks cose for 1000 - 10k nodes', () => {
    expect(selectLayoutForNodeCount(5_000)).toBe('cose');
  });
  it('picks force for > 10k nodes', () => {
    expect(selectLayoutForNodeCount(20_000)).toBe('force');
  });
});

describe('LAYOUT_REGISTRY', () => {
  it('every layout name resolves to a layout with options bag', () => {
    expect(LAYOUT_REGISTRY.cose).toBe(COSE_LAYOUT);
    expect(LAYOUT_REGISTRY.dagre).toBe(DAGRE_LAYOUT);
    expect(LAYOUT_REGISTRY.breadthfirst).toBe(BREADTHFIRST_LAYOUT);
    expect(LAYOUT_REGISTRY.grid).toBe(GRID_LAYOUT);
    expect(LAYOUT_REGISTRY.radial).toBe(RADIAL_LAYOUT);
    for (const name of Object.keys(LAYOUT_REGISTRY)) {
      const l = LAYOUT_REGISTRY[name as keyof typeof LAYOUT_REGISTRY];
      expect(typeof l.name).toBe('string');
      expect(l.options ?? {}).toBeTypeOf('object');
    }
  });
});
