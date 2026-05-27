/**
 * WCAG 2.2 AA accessibility checks for graph-viz wrappers.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CytoscapeView } from '../components/CytoscapeView';
import { SigmaView } from '../components/SigmaView';
import { ReactFlowView } from '../components/ReactFlowView';
import { TimeSeriesWithForecast } from '../components/TimeSeriesWithForecast';
import { SankeyView } from '../components/SankeyView';
import { ForceGraphView } from '../components/ForceGraphView';

describe('Accessibility — WCAG 2.2 AA', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const edges = [{ id: 'e', source: 'a', target: 'b' }];

  it('CytoscapeView container exposes aria-label and tabIndex=0', () => {
    const { container } = render(
      <CytoscapeView nodes={nodes} edges={edges} ariaLabel="a11y-cy" />,
    );
    const el = container.querySelector('[data-testid="graph-viz-cytoscape"]') as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-label')).toBe('a11y-cy');
    expect(el?.getAttribute('role')).toBe('img');
    expect(el?.tabIndex).toBe(0);
  });

  it('SigmaView container exposes aria-label and tabIndex=0', () => {
    const { container } = render(
      <SigmaView nodes={nodes} edges={edges} ariaLabel="a11y-sigma" />,
    );
    const el = container.querySelector('[data-testid="graph-viz-sigma"]') as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-label')).toBe('a11y-sigma');
    expect(el?.getAttribute('role')).toBe('img');
    expect(el?.tabIndex).toBe(0);
  });

  it('ReactFlowView container exposes aria-label and tabIndex=0', () => {
    const { container } = render(
      <ReactFlowView nodes={nodes} edges={edges} ariaLabel="a11y-rf" />,
    );
    const el = container.querySelector('[data-testid="graph-viz-reactflow"]') as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-label')).toBe('a11y-rf');
    expect(el?.getAttribute('role')).toBe('img');
  });

  it('TimeSeriesWithForecast svg has title + desc + aria-label', () => {
    const { container } = render(
      <TimeSeriesWithForecast
        seriesName="ts"
        historical={[{ t: '2026-01-01', y: 1 }]}
        forecast={[{ t: '2026-02-01', point: 1 }]}
        ariaLabel="a11y-ts"
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-label')).toBe('a11y-ts');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.querySelector('title')?.textContent).toBe('a11y-ts');
    expect(svg?.querySelector('desc')).not.toBeNull();
  });

  it('SankeyView svg fallback has role=img + aria-label', () => {
    const { container } = render(
      <SankeyView
        nodes={[{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]}
        links={[{ source: 'a', target: 'b', value: 100 }]}
        ariaLabel="a11y-sankey"
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-label')).toBe('a11y-sankey');
    expect(svg?.getAttribute('role')).toBe('img');
  });

  it('ForceGraphView fallback svg has role=img + aria-label', () => {
    const { container } = render(
      <ForceGraphView nodes={nodes} edges={edges} ariaLabel="a11y-force" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-label')).toBe('a11y-force');
    expect(svg?.getAttribute('role')).toBe('img');
  });
});
