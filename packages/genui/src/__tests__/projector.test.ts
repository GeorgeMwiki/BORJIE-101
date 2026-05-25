/**
 * Piece-G projector pure-function tests.
 *
 * Exercises every catalog `component_type` through the projector to
 * ensure each one returns a non-null `AgUiUiPart` of the expected
 * `kind`. The renderer tests cover the React-side wiring; this file
 * keeps the pure projection logic at 100% statement coverage.
 */

import { describe, it, expect } from 'vitest';
import { projectArtifactToUiPart } from '../projector';
import {
  ARTIFACT_CATALOG,
  type ArtifactComponentType,
} from '../catalog';

const FIXTURES: Record<ArtifactComponentType, { props: Record<string, unknown>; data: Record<string, unknown>; expectedKind: string }> = {
  kpi_tile: {
    props: { label: 'MRR', format: 'currency', currency: 'TZS' },
    data: { value: 1234, delta: 0.1, deltaDirection: 'up' },
    expectedKind: 'kpi-grid',
  },
  metric_grid: {
    props: { tiles: [{ label: 'X', value: 1, format: 'number' }] },
    data: {},
    expectedKind: 'kpi-grid',
  },
  bar_chart: {
    props: { xField: 'm', yField: 'r', orientation: 'horizontal' },
    data: { rows: [{ m: 'Jan', r: 1 }] },
    expectedKind: 'chart-vega',
  },
  line_chart: {
    props: { xField: 'm', yField: 'r', seriesField: 'channel' },
    data: { rows: [{ m: 'Jan', r: 1, channel: 'web' }] },
    expectedKind: 'chart-vega',
  },
  pie_chart: {
    props: { categoryField: 'c', valueField: 'v', innerRadius: 0.4 },
    data: { rows: [{ c: 'A', v: 1 }] },
    expectedKind: 'chart-vega',
  },
  scatter: {
    props: { xField: 'x', yField: 'y', sizeField: 's', colorField: 'k' },
    data: { rows: [{ x: 1, y: 2, s: 3, k: 'A' }] },
    expectedKind: 'chart-vega',
  },
  funnel: {
    props: { labelField: 'step', valueField: 'count' },
    data: { rows: [{ step: 'visit', count: 100 }] },
    expectedKind: 'chart-vega',
  },
  treemap: {
    props: { labelField: 'n', valueField: 'v' },
    data: { rows: [{ n: 'A', v: 1 }] },
    expectedKind: 'chart-vega',
  },
  sankey: {
    props: {},
    data: { links: [{ source: 'A', target: 'B', value: 1 }] },
    expectedKind: 'chart-vega',
  },
  radar: {
    props: { axisField: 'a', valueField: 'v', seriesField: 's' },
    data: { rows: [{ a: 'A', v: 1, s: 'B' }] },
    expectedKind: 'chart-vega',
  },
  box_plot: {
    props: { groupField: 'g', valueField: 'v' },
    data: { rows: [{ g: 'A', v: 1 }] },
    expectedKind: 'chart-vega',
  },
  histogram: {
    props: { valueField: 'v', binCount: 10 },
    data: { rows: [{ v: 1 }] },
    expectedKind: 'chart-vega',
  },
  data_table: {
    props: {
      columns: [{ id: 'c', header: 'C', accessorKey: 'c' }],
      rows: [{ c: 1 }],
    },
    data: {},
    expectedKind: 'data-table',
  },
  pivot_table: {
    props: {
      rowDimensions: ['property'],
      colDimensions: ['month'],
      measures: [{ field: 'rent', aggregator: 'sum', format: 'currency', currency: 'TZS' }],
    },
    data: { rows: [{ property: 'P1', month: 'Jan', rent: 200 }] },
    expectedKind: 'data-table',
  },
  form: {
    props: { formId: 'lease', schemaJson: {}, values: {}, action: '/api/gateway/forms/lease' },
    data: {},
    expectedKind: 'prefill-form',
  },
  deck_slide: {
    props: { title: 'Welcome' },
    data: { bullets: ['One', 'Two'], body: 'Hello' },
    expectedKind: 'markdown-card',
  },
  doc_section: {
    props: { heading: 'Intro', level: 2 },
    data: { markdown: 'Hi.' },
    expectedKind: 'markdown-card',
  },
  markdown: {
    props: { markdown: '# hi', severity: 'info' },
    data: {},
    expectedKind: 'markdown-card',
  },
  callout: {
    props: { severity: 'warning', title: 'Heads up' },
    data: { message: 'rent due' },
    expectedKind: 'markdown-card',
  },
  image: {
    props: { alt: 'A photo', caption: 'Hi' },
    data: { url: 'https://example.com/p.png' },
    expectedKind: 'media-grid',
  },
  video: {
    props: { title: 'V', poster: 'https://example.com/v.png' },
    data: { url: 'https://example.com/v.mp4', mimeType: 'video/mp4' },
    expectedKind: 'media-grid',
  },
  map_view: {
    props: { center: [-6.2, 35.7], zoom: 6, markers: [] },
    data: {},
    expectedKind: 'map',
  },
  heatmap: {
    props: {
      xAxis: ['Mon'],
      yAxis: ['09:00'],
      cells: [[1]],
      colorScale: 'linear',
      format: 'count',
      currency: 'TZS',
      unit: 'cells',
      minValue: 0,
      maxValue: 100,
    },
    data: {},
    expectedKind: 'heatmap',
  },
  timeline: {
    props: {
      events: [{ timestamp: '2026-05-21T12:00:00Z', title: 'Ping', severity: 'info' }],
    },
    data: {},
    expectedKind: 'timeline',
  },
  kanban: {
    props: { columns: [{ id: 'todo', title: 'Todo', cards: [] }] },
    data: {},
    expectedKind: 'kanban',
  },
  gantt: {
    props: { rangeStart: '2026-01-01', rangeEnd: '2026-12-31' },
    data: {
      bars: [
        { id: 't1', label: 'Task', start: '2026-01-01', end: '2026-02-01', status: 'running' },
      ],
    },
    expectedKind: 'workflow',
  },
  workflow: {
    props: { steps: [{ label: 'a', status: 'done' }], currentIndex: 0 },
    data: {},
    expectedKind: 'workflow',
  },
  code_block: {
    props: { code: 'select 1;', language: 'sql', filename: 'q.sql', highlightLines: [1] },
    data: {},
    expectedKind: 'code-block',
  },
  comparison: {
    props: { columns: ['A', 'B'], rows: [{ key: 'r', label: 'L', values: ['1', '2'] }] },
    data: {},
    expectedKind: 'comparison-table',
  },
  sparkline: {
    props: { label: 'l', value: 1, format: 'number', sparkline: [1, 2], delta: 1, deltaIsPositive: true },
    data: {},
    expectedKind: 'metric-sparkline',
  },
  gauge: {
    props: { value: 50, min: 0, max: 100, label: 'U', format: 'percent', currency: 'TZS', thresholds: [{ value: 75, color: '#f00' }] },
    data: {},
    expectedKind: 'gauge',
  },
  org_chart: {
    props: { root: { id: '1', label: 'CEO' }, orientation: 'vertical' },
    data: {},
    expectedKind: 'org-chart',
  },
};

describe('projectArtifactToUiPart', () => {
  for (const entry of ARTIFACT_CATALOG) {
    const fixture = FIXTURES[entry.key];
    it(`projects ${entry.key} → ${fixture.expectedKind}`, () => {
      const part = projectArtifactToUiPart(
        entry.key,
        fixture.props,
        fixture.data,
      );
      expect(part).not.toBeNull();
      expect(part?.kind).toBe(fixture.expectedKind);
    });
  }

  it('returns null for an unknown component_type', () => {
    const part = projectArtifactToUiPart('not_a_real_type' as never, {}, {});
    expect(part).toBeNull();
  });

  it('survives malformed map_view center', () => {
    const part = projectArtifactToUiPart('map_view', { center: 'not-an-array' }, {});
    expect(part?.kind).toBe('map');
  });

  it('survives missing org_chart root', () => {
    const part = projectArtifactToUiPart('org_chart', {}, {});
    expect(part).toBeNull();
  });
});
