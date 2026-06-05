import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutstandingRoyaltyProjectionChart } from '../generative-ui/blocks/outstanding-royalty-projection-chart';
import { AssetComparisonTable } from '../generative-ui/blocks/asset-comparison-table';
import { OfftakeTimelineDiagram } from '../generative-ui/blocks/offtake-timeline-diagram';
import { MaintenanceCaseFlowDiagram } from '../generative-ui/blocks/maintenance-case-flow-diagram';
import type {
  OutstandingRoyaltyProjectionChartBlock,
  OfftakeTimelineDiagramBlock,
  MaintenanceCaseFlowDiagramBlock,
  AssetComparisonTableBlock,
} from '../generative-ui/types';

describe('OutstandingRoyaltyProjectionChart', () => {
  it('renders the chart with provided points', () => {
    const block: OutstandingRoyaltyProjectionChartBlock = {
      id: 'a1',
      type: 'outstanding_royalty_projection_chart',
      position: 'below',
      title: 'Outstanding royalties',
      monthlyRoyalty: 25000,
      currency: 'KES',
      monthsDelinquent: 3,
      lateFeePerMonth: 1000,
      points: [
        { month: 0, cumulative: 0 },
        { month: 1, cumulative: 26000 },
        { month: 2, cumulative: 52000 },
        { month: 3, cumulative: 78000 },
      ],
    };
    render(<OutstandingRoyaltyProjectionChart block={block} language="en" />);
    expect(screen.getByTestId('outstanding-royalty-projection-chart')).toBeInTheDocument();
    expect(screen.getByTestId('outstanding-royalty-line')).toBeInTheDocument();
  });

  it('handles empty points gracefully', () => {
    const block: OutstandingRoyaltyProjectionChartBlock = {
      id: 'a2',
      type: 'outstanding_royalty_projection_chart',
      position: 'below',
      title: 'Outstanding royalties',
      monthlyRoyalty: 10000,
      currency: 'KES',
      monthsDelinquent: 0,
      lateFeePerMonth: 0,
      points: [],
    };
    render(<OutstandingRoyaltyProjectionChart block={block} language="en" />);
    expect(screen.getByTestId('outstanding-royalty-projection-chart')).toBeInTheDocument();
  });
});

describe('AssetComparisonTable', () => {
  it('renders headers and rows', () => {
    const block: AssetComparisonTableBlock = {
      id: 'p1',
      type: 'asset_comparison_table',
      position: 'below',
      title: 'Asset comparison',
      columns: [{ header: 'Unit A' }, { header: 'Unit B', highlight: true }],
      rows: [{ label: 'Royalty', values: ['25,000', '30,000'] }],
    };
    render(<AssetComparisonTable block={block} language="en" />);
    expect(screen.getByText('Unit A')).toBeInTheDocument();
    expect(screen.getByText('Unit B')).toBeInTheDocument();
    expect(screen.getByText('25,000')).toBeInTheDocument();
  });

  it('shows empty state when no rows', () => {
    const block: AssetComparisonTableBlock = {
      id: 'p2',
      type: 'asset_comparison_table',
      position: 'below',
      title: 'Empty',
      columns: [],
      rows: [],
    };
    render(<AssetComparisonTable block={block} language="en" />);
    expect(screen.getByTestId('asset-comparison-empty')).toBeInTheDocument();
  });
});

describe('OfftakeTimelineDiagram', () => {
  it('renders each event by status', () => {
    const block: OfftakeTimelineDiagramBlock = {
      id: 'l1',
      type: 'offtake_timeline_diagram',
      position: 'below',
      title: 'Offtake timeline',
      events: [
        { label: 'Signing', date: 'Jan', status: 'completed' },
        { label: 'Renewal', date: 'Oct', status: 'current' },
        { label: 'End', date: 'Dec', status: 'upcoming' },
      ],
    };
    render(<OfftakeTimelineDiagram block={block} language="en" />);
    expect(screen.getByTestId('offtake-event-completed')).toBeInTheDocument();
    expect(screen.getByTestId('offtake-event-current')).toBeInTheDocument();
    expect(screen.getByTestId('offtake-event-upcoming')).toBeInTheDocument();
  });

  it('shows empty state when events missing', () => {
    const block: OfftakeTimelineDiagramBlock = {
      id: 'l2',
      type: 'offtake_timeline_diagram',
      position: 'below',
      title: 'Empty',
      events: [],
    };
    render(<OfftakeTimelineDiagram block={block} language="en" />);
    expect(screen.getByTestId('offtake-timeline-empty')).toBeInTheDocument();
  });
});

describe('MaintenanceCaseFlowDiagram', () => {
  it('renders all stages and marks the current one', () => {
    const block: MaintenanceCaseFlowDiagramBlock = {
      id: 'm1',
      type: 'maintenance_case_flow_diagram',
      position: 'below',
      title: 'Case flow',
      currentStage: 'assigned',
      stages: [
        { id: 'reported', label: 'Reported' },
        { id: 'triaged', label: 'Triaged' },
        { id: 'assigned', label: 'Assigned' },
        { id: 'resolved', label: 'Resolved' },
      ],
    };
    render(<MaintenanceCaseFlowDiagram block={block} language="en" />);
    expect(screen.getByTestId('maintenance-case-flow-diagram')).toHaveAttribute(
      'data-current-stage',
      'assigned',
    );
    expect(screen.getByTestId('maintenance-stage-reported')).toBeInTheDocument();
    expect(screen.getByTestId('maintenance-stage-resolved')).toBeInTheDocument();
  });
});
