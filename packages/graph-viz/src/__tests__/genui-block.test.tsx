/**
 * GenUI block dispatcher tests — picks the correct component per
 * payload shape AND surfaces a malformed-payload card when the
 * payload fails its discriminated-union schema.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  GraphVizBlock,
  GraphVizBlockSchema,
  pickComponentForPayload,
  type GraphVizBlockPayload,
} from '../genui-blocks/graph-viz-block';

describe('GraphVizBlockSchema', () => {
  it('accepts a valid graph payload', () => {
    const result = GraphVizBlockSchema.safeParse({
      kind: 'graph-viz',
      shape: 'graph',
      nodes: [{ id: 'a' }],
      edges: [],
      ariaLabel: 'tiny graph',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid sankey payload', () => {
    const result = GraphVizBlockSchema.safeParse({
      kind: 'graph-viz',
      shape: 'sankey',
      nodes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      links: [{ source: 'a', target: 'b', value: 100 }],
      ariaLabel: 'tiny sankey',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid time-series payload', () => {
    const result = GraphVizBlockSchema.safeParse({
      kind: 'graph-viz',
      shape: 'time-series',
      historical: [{ t: '2026-01-01', y: 100 }],
      forecast: [{ t: '2026-02-01', point: 110 }],
      seriesName: 'demo',
      ariaLabel: 'tiny ts',
    });
    expect(result.success).toBe(true);
  });

  it('rejects payload with unknown shape', () => {
    const result = GraphVizBlockSchema.safeParse({
      kind: 'graph-viz',
      shape: 'nope',
      ariaLabel: 'bad',
    });
    expect(result.success).toBe(false);
  });
});

describe('pickComponentForPayload', () => {
  it('routes shape=sankey → sankey', () => {
    const p: GraphVizBlockPayload = {
      kind: 'graph-viz',
      shape: 'sankey',
      nodes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      links: [{ source: 'a', target: 'b', value: 1 }],
      ariaLabel: 'x',
    };
    expect(pickComponentForPayload(p).component).toBe('sankey');
  });

  it('routes shape=time-series → time-series', () => {
    const p: GraphVizBlockPayload = {
      kind: 'graph-viz',
      shape: 'time-series',
      historical: [{ t: '2026-01-01', y: 1 }],
      forecast: [{ t: '2026-02-01', point: 1 }],
      seriesName: 's',
      ariaLabel: 'x',
    };
    expect(pickComponentForPayload(p).component).toBe('time-series');
  });

  it('routes shape=graph + small N → cytoscape', () => {
    const p: GraphVizBlockPayload = {
      kind: 'graph-viz',
      shape: 'graph',
      nodes: Array.from({ length: 12 }).map((_, i) => ({ id: `n${i}` })),
      edges: [],
      ariaLabel: 'x',
    };
    expect(pickComponentForPayload(p).component).toBe('cytoscape');
  });

  it('routes shape=graph + huge N → sigma', () => {
    const p: GraphVizBlockPayload = {
      kind: 'graph-viz',
      shape: 'graph',
      nodes: Array.from({ length: 20_000 }).map((_, i) => ({ id: `n${i}` })),
      edges: [],
      ariaLabel: 'x',
    };
    expect(pickComponentForPayload(p).component).toBe('sigma');
  });

  it('honours explicit engine override', () => {
    const p: GraphVizBlockPayload = {
      kind: 'graph-viz',
      shape: 'graph',
      nodes: [{ id: 'n1' }],
      edges: [],
      engine: 'echarts',
      ariaLabel: 'x',
    };
    expect(pickComponentForPayload(p).component).toBe('echarts');
  });
});

describe('GraphVizBlock render', () => {
  it('renders a malformed card on bad payloads instead of crashing', () => {
    const { container } = render(
      <GraphVizBlock payload={{ shape: 'unknown' } as unknown as GraphVizBlockPayload} />,
    );
    expect(container.querySelector('[data-graph-viz-malformed="true"]')).not.toBeNull();
  });

  it('renders something for a valid sankey payload', () => {
    const { container } = render(
      <GraphVizBlock
        payload={{
          kind: 'graph-viz',
          shape: 'sankey',
          nodes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
          links: [{ source: 'a', target: 'b', value: 100 }],
          ariaLabel: 'sk',
        }}
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
