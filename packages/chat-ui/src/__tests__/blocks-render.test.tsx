import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArrearsProjectionChart } from '../generative-ui/blocks/arrears-projection-chart';
import { PropertyComparisonTable } from '../generative-ui/blocks/property-comparison-table';
import { LeaseTimelineDiagram } from '../generative-ui/blocks/lease-timeline-diagram';
import { MaintenanceCaseFlowDiagram } from '../generative-ui/blocks/maintenance-case-flow-diagram';
import type {
  ArrearsProjectionChartBlock,
  LeaseTimelineDiagramBlock,
  MaintenanceCaseFlowDiagramBlock,
  PropertyComparisonTableBlock,
} from '../generative-ui/types';

describe('ArrearsProjectionChart', () => {
  it('renders the chart with provided points', () => {
    const block: ArrearsProjectionChartBlock = {
      id: 'a1',
      type: 'arrears_projection_chart',
      position: 'below',
      title: 'Arrears',
      monthlyRent: 25000,
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
    render(<ArrearsProjectionChart block={block} language="en" />);
    expect(screen.getByTestId('arrears-projection-chart')).toBeInTheDocument();
    expect(screen.getByTestId('arrears-line')).toBeInTheDocument();
  });

  it('handles empty points gracefully', () => {
    const block: ArrearsProjectionChartBlock = {
      id: 'a2',
      type: 'arrears_projection_chart',
      position: 'below',
      title: 'Arrears',
      monthlyRent: 10000,
      currency: 'KES',
      monthsDelinquent: 0,
      lateFeePerMonth: 0,
      points: [],
    };
    render(<ArrearsProjectionChart block={block} language="en" />);
    expect(screen.getByTestId('arrears-projection-chart')).toBeInTheDocument();
  });
});

describe('PropertyComparisonTable', () => {
  it('renders headers and rows', () => {
    const block: PropertyComparisonTableBlock = {
      id: 'p1',
      type: 'property_comparison_table',
      position: 'below',
      title: 'Property comparison',
      columns: [{ header: 'Unit A' }, { header: 'Unit B', highlight: true }],
      rows: [{ label: 'Rent', values: ['25,000', '30,000'] }],
    };
    render(<PropertyComparisonTable block={block} language="en" />);
    expect(screen.getByText('Unit A')).toBeInTheDocument();
    expect(screen.getByText('Unit B')).toBeInTheDocument();
    expect(screen.getByText('25,000')).toBeInTheDocument();
  });

  it('shows empty state when no rows', () => {
    const block: PropertyComparisonTableBlock = {
      id: 'p2',
      type: 'property_comparison_table',
      position: 'below',
      title: 'Empty',
      columns: [],
      rows: [],
    };
    render(<PropertyComparisonTable block={block} language="en" />);
    expect(screen.getByTestId('property-comparison-empty')).toBeInTheDocument();
  });
});

describe('LeaseTimelineDiagram', () => {
  it('renders each event by status', () => {
    const block: LeaseTimelineDiagramBlock = {
      id: 'l1',
      type: 'lease_timeline_diagram',
      position: 'below',
      title: 'Lease timeline',
      events: [
        { label: 'Signing', date: 'Jan', status: 'completed' },
        { label: 'Renewal', date: 'Oct', status: 'current' },
        { label: 'End', date: 'Dec', status: 'upcoming' },
      ],
    };
    render(<LeaseTimelineDiagram block={block} language="en" />);
    expect(screen.getByTestId('lease-event-completed')).toBeInTheDocument();
    expect(screen.getByTestId('lease-event-current')).toBeInTheDocument();
    expect(screen.getByTestId('lease-event-upcoming')).toBeInTheDocument();
  });

  it('shows empty state when events missing', () => {
    const block: LeaseTimelineDiagramBlock = {
      id: 'l2',
      type: 'lease_timeline_diagram',
      position: 'below',
      title: 'Empty',
      events: [],
    };
    render(<LeaseTimelineDiagram block={block} language="en" />);
    expect(screen.getByTestId('lease-timeline-empty')).toBeInTheDocument();
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
