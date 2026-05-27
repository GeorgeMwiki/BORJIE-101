/**
 * Smoke tests — every component mounts without throwing in jsdom.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CytoscapeView } from '../components/CytoscapeView';
import { ReactFlowView } from '../components/ReactFlowView';
import { SigmaView } from '../components/SigmaView';
import { SankeyView } from '../components/SankeyView';
import { ForceGraphView } from '../components/ForceGraphView';
import { EChartsGraph } from '../components/EChartsGraph';
import { TimeSeriesWithForecast } from '../components/TimeSeriesWithForecast';

const tinyNodes = [
  { id: 'n1', label: 'A', kind: 'licence' },
  { id: 'n2', label: 'B', kind: 'royalty-payer' },
  { id: 'n3', label: 'C', kind: 'transporter' },
];
const tinyEdges = [
  { id: 'e1', source: 'n1', target: 'n2', label: 'pays' },
  { id: 'e2', source: 'n2', target: 'n3', label: 'ships' },
];

describe('Component smoke — mounts without throwing', () => {
  it('CytoscapeView renders a role=img container', () => {
    const { container, queryByLabelText } = render(
      <CytoscapeView nodes={tinyNodes} edges={tinyEdges} ariaLabel="cy-test" />,
    );
    expect(container.querySelector('[data-testid="graph-viz-cytoscape"]')).not.toBeNull();
    expect(queryByLabelText('cy-test')).not.toBeNull();
  });

  it('ReactFlowView renders a role=img container', () => {
    const { container } = render(
      <ReactFlowView nodes={tinyNodes} edges={tinyEdges} ariaLabel="rf-test" />,
    );
    expect(container.querySelector('[data-testid="graph-viz-reactflow"]')).not.toBeNull();
  });

  it('SigmaView renders a role=img container', () => {
    const { container } = render(
      <SigmaView nodes={tinyNodes} edges={tinyEdges} ariaLabel="sigma-test" />,
    );
    expect(container.querySelector('[data-testid="graph-viz-sigma"]')).not.toBeNull();
  });

  it('SankeyView renders an svg with role=img', () => {
    const { container } = render(
      <SankeyView
        nodes={[
          { id: 'mine', name: 'Mine' },
          { id: 'export', name: 'Export' },
        ]}
        links={[{ source: 'mine', target: 'export', value: 100 }]}
        ariaLabel="sankey-test"
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('ForceGraphView renders an svg fallback', () => {
    const { container } = render(
      <ForceGraphView nodes={tinyNodes} edges={tinyEdges} ariaLabel="force-test" />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('EChartsGraph renders a container without throwing', () => {
    const { container } = render(
      <EChartsGraph nodes={tinyNodes} edges={tinyEdges} ariaLabel="echarts-test" />,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it('TimeSeriesWithForecast renders an svg with axes', () => {
    const { container } = render(
      <TimeSeriesWithForecast
        seriesName="Gold (USD/oz)"
        historical={[
          { t: '2026-01-01', y: 2000 },
          { t: '2026-02-01', y: 2080 },
          { t: '2026-03-01', y: 2140 },
        ]}
        forecast={[
          { t: '2026-04-01', point: 2200, lower80: 2100, upper80: 2300, lower95: 2050, upper95: 2350 },
          { t: '2026-05-01', point: 2240, lower80: 2120, upper80: 2360, lower95: 2050, upper95: 2440 },
        ]}
        ariaLabel="ts-test"
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('svg path')).not.toBeNull();
  });
});
