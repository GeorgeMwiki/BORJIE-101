/**
 * Mining-domain wrapper tests.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  buildLicenceGraphProps,
  buildSupplyChainSankeyProps,
  buildRoyaltySankeyProps,
  buildGanttRows,
  LicenceRelationshipGraph,
  SupplyChainSankey,
  WorkerShiftGantt,
  RoyaltyFlowSankey,
  MineralPriceWithForecast,
  MR_MWIKILA_PERSONA,
} from '../domain/mining-vizzes';

describe('buildLicenceGraphProps', () => {
  it('projects licences + relationships into GraphNode/Edge shape', () => {
    const out = buildLicenceGraphProps({
      licences: [
        { licenceId: 'L1', holder: 'AcmeCo', mineral: 'Gold', jurisdiction: 'TZ', status: 'active' },
        { licenceId: 'L2', holder: 'Tin Ltd', mineral: 'Tin', jurisdiction: 'TZ', status: 'pending' },
      ],
      relationships: [
        { source: 'L1', target: 'L2', relation: 'subsidiary' },
      ],
    });
    expect(out.nodes).toHaveLength(2);
    expect(out.nodes[0]?.id).toBe('L1');
    expect(out.nodes[0]?.kind).toBe('status-active');
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]?.source).toBe('L1');
    expect(out.edges[0]?.target).toBe('L2');
    expect(out.edges[0]?.directed).toBe(true);
    expect(out.edges[0]?.kind).toBe('subsidiary');
  });
});

describe('buildSupplyChainSankeyProps', () => {
  it('projects supply chain stages into Sankey nodes and filters zero flows', () => {
    const out = buildSupplyChainSankeyProps({
      stages: [
        { id: 'M', stage: 'extraction', name: 'Mine A' },
        { id: 'H', stage: 'haulage', name: 'Haul' },
        { id: 'E', stage: 'export', name: 'Port' },
      ],
      flows: [
        { source: 'M', target: 'H', tonnes: 500 },
        { source: 'H', target: 'E', tonnes: 480 },
        { source: 'M', target: 'E', tonnes: 0 },
      ],
    });
    expect(out.nodes).toHaveLength(3);
    expect(out.links).toHaveLength(2);
    expect(out.links.every((l) => l.value > 0)).toBe(true);
  });
});

describe('buildRoyaltySankeyProps', () => {
  it('collects unique node ids and uses the first flow currency if not provided', () => {
    const out = buildRoyaltySankeyProps({
      flows: [
        { source: 'Op-1', target: 'TZ-Treasury', amount: 1_000_000, currency: 'TZS' },
        { source: 'Op-2', target: 'TZ-Treasury', amount: 2_500_000, currency: 'TZS' },
      ],
    });
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['Op-1', 'Op-2', 'TZ-Treasury']);
    expect(out.links).toHaveLength(2);
    expect(out.currency).toBe('TZS');
    expect(out.totalAmount).toBe(3_500_000);
  });

  it('falls back to TZS when no flows have a currency', () => {
    const out = buildRoyaltySankeyProps({ flows: [] });
    expect(out.currency).toBe('TZS');
    expect(out.nodes).toHaveLength(0);
    expect(out.links).toHaveLength(0);
  });
});

describe('buildGanttRows', () => {
  it('groups shifts by worker and computes min/max range', () => {
    const out = buildGanttRows([
      { workerId: 'W1', workerName: 'Asha', start: '2026-05-27T06:00:00Z', end: '2026-05-27T14:00:00Z', role: 'driller', status: 'completed' },
      { workerId: 'W1', workerName: 'Asha', start: '2026-05-27T15:00:00Z', end: '2026-05-27T23:00:00Z', role: 'driller', status: 'in-progress' },
      { workerId: 'W2', workerName: 'Bob', start: '2026-05-27T08:00:00Z', end: '2026-05-27T16:00:00Z', role: 'haulier', status: 'planned' },
    ]);
    expect(out.rows).toHaveLength(2);
    const asha = out.rows.find((r) => r.workerId === 'W1');
    expect(asha?.bars).toHaveLength(2);
    expect(out.minMs).toBe(new Date('2026-05-27T06:00:00Z').getTime());
    expect(out.maxMs).toBe(new Date('2026-05-27T23:00:00Z').getTime());
  });

  it('returns empty rows for empty shifts', () => {
    const out = buildGanttRows([]);
    expect(out.rows).toEqual([]);
  });
});

describe('Mining wrapper render smoke tests', () => {
  it('LicenceRelationshipGraph mounts and bears the persona label', () => {
    const { container } = render(
      <LicenceRelationshipGraph
        licences={[
          { licenceId: 'L1', holder: 'AcmeCo', mineral: 'Gold', jurisdiction: 'TZ', status: 'active' },
        ]}
        relationships={[]}
      />,
    );
    const el = container.querySelector('[data-testid="mining-licence-relationship-graph"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-label')).toContain(MR_MWIKILA_PERSONA);
  });

  it('SupplyChainSankey mounts with default tonnes unit', () => {
    const { container } = render(
      <SupplyChainSankey
        stages={[
          { id: 'M', stage: 'extraction', name: 'Mine A' },
          { id: 'E', stage: 'export', name: 'Port' },
        ]}
        flows={[{ source: 'M', target: 'E', tonnes: 100 }]}
      />,
    );
    const el = container.querySelector('[data-testid="mining-supply-chain-sankey"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-label')).toContain('Sankey');
  });

  it('WorkerShiftGantt mounts as an SVG with the persona label', () => {
    const { container } = render(
      <WorkerShiftGantt
        shifts={[
          { workerId: 'W1', workerName: 'Asha', start: '2026-05-27T06:00:00Z', end: '2026-05-27T14:00:00Z', role: 'driller', status: 'completed' },
        ]}
      />,
    );
    const svg = container.querySelector('[data-testid="mining-worker-shift-gantt"]');
    expect(svg).not.toBeNull();
    expect(svg?.tagName.toLowerCase()).toBe('svg');
  });

  it('RoyaltyFlowSankey mounts and prefers caller currency', () => {
    const { container } = render(
      <RoyaltyFlowSankey
        flows={[{ source: 'Op-1', target: 'Treasury', amount: 100, currency: 'USD' }]}
        currency="USD"
      />,
    );
    const el = container.querySelector('[data-testid="mining-royalty-flow-sankey"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-label')).toContain('USD');
  });

  it('MineralPriceWithForecast mounts and labels mineral + unit', () => {
    const { container } = render(
      <MineralPriceWithForecast
        priceHistory={{
          mineral: 'Gold',
          unit: 'USD/oz',
          historical: [{ t: '2026-01-01', y: 2000 }, { t: '2026-02-01', y: 2080 }],
          forecast: [{ t: '2026-03-01', point: 2150, lower80: 2100, upper80: 2200 }],
        }}
      />,
    );
    const el = container.querySelector('[data-testid="mining-mineral-price-with-forecast"]');
    expect(el).not.toBeNull();
    const aria = el?.getAttribute('aria-label') ?? '';
    expect(aria).toContain('Gold');
    expect(aria).toContain('USD/oz');
  });
});
