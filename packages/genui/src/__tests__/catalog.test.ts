/**
 * Piece-G catalog Zod validation tests.
 *
 * One acceptance + one rejection assertion per catalog entry. The
 * catalog is the security boundary — every payload from the brain is
 * funneled through these schemas before the renderer touches it.
 */

import { describe, it, expect } from 'vitest';
import {
  ARTIFACT_CATALOG,
  ARTIFACT_CATALOG_BY_KEY,
  ARTIFACT_COMPONENT_TYPES,
  listArtifactTypes,
  type ArtifactComponentType,
} from '../catalog';

const SAMPLES: Record<ArtifactComponentType, { props: unknown; data: unknown }> = {
  kpi_tile: {
    props: { label: 'MRR', format: 'currency', currency: 'TZS' },
    data: { value: 12345, delta: 0.04, deltaDirection: 'up' },
  },
  bar_chart: {
    props: { xField: 'month', yField: 'revenue', title: 'Monthly' },
    data: { rows: [{ month: 'Jan', revenue: 100 }] },
  },
  line_chart: {
    props: { xField: 'month', yField: 'rev' },
    data: { rows: [{ month: 'Jan', rev: 100 }] },
  },
  pie_chart: {
    props: { categoryField: 'cat', valueField: 'val' },
    data: { rows: [{ cat: 'A', val: 5 }] },
  },
  data_table: {
    props: {
      columns: [{ id: 'c', header: 'C', accessorKey: 'c' }],
      rows: [{ c: 1 }],
    },
    data: {},
  },
  form: {
    props: {
      formId: 'lease-renewal',
      schemaJson: {},
      values: {},
      action: '/api/gateway/forms/lease-renewal',
    },
    data: {},
  },
  deck_slide: {
    props: { title: 'Hi', layout: 'title-bullet' },
    data: { bullets: ['One', 'Two'] },
  },
  doc_section: {
    props: { heading: 'Intro', level: 2 },
    data: { markdown: 'Hello world.' },
  },
  map_view: {
    props: {
      center: [-6.2, 35.7],
      zoom: 6,
      markers: [],
    },
    data: {},
  },
  heatmap: {
    props: {
      xAxis: ['Mon'],
      yAxis: ['09:00'],
      cells: [[1]],
      colorScale: 'linear',
      format: 'count',
    },
    data: {},
  },
  timeline: {
    props: {
      events: [
        { timestamp: '2026-05-21T12:00:00Z', title: 'Ping', severity: 'info' },
      ],
    },
    data: {},
  },
  kanban: {
    props: { columns: [{ id: 'todo', title: 'Todo', cards: [] }] },
    data: {},
  },
  gantt: {
    props: { rangeStart: '2026-01-01', rangeEnd: '2026-12-31' },
    data: {
      bars: [
        { id: 't1', label: 'Task 1', start: '2026-01-01', end: '2026-02-01', status: 'done' },
      ],
    },
  },
  funnel: {
    props: { labelField: 'step', valueField: 'count' },
    data: { rows: [{ step: 'visit', count: 100 }] },
  },
  metric_grid: {
    props: {
      tiles: [{ label: 'X', value: 1, format: 'number' }],
    },
    data: {},
  },
  image: {
    props: { alt: 'A photo' },
    data: { url: 'https://example.com/photo.png' },
  },
  video: {
    props: { title: 'Walk-through' },
    data: { url: 'https://example.com/v.mp4', mimeType: 'video/mp4' },
  },
  code_block: {
    props: { code: 'select 1;', language: 'sql' },
    data: {},
  },
  markdown: {
    props: { markdown: '# hi', severity: 'info' },
    data: {},
  },
  callout: {
    props: { severity: 'warning', title: 'Heads up' },
    data: { message: 'rent due tomorrow' },
  },
  comparison: {
    props: {
      columns: ['Tier A', 'Tier B'],
      rows: [{ key: 'r', label: 'Rent', values: ['100', '200'] }],
    },
    data: {},
  },
  pivot_table: {
    props: {
      rowDimensions: ['property'],
      colDimensions: ['month'],
      measures: [{ field: 'rent', aggregator: 'sum', format: 'currency', currency: 'TZS' }],
    },
    data: { rows: [{ property: 'P1', month: 'Jan', rent: 200 }] },
  },
  sparkline: {
    props: { label: 'Latency', value: 124, format: 'number', sparkline: [1, 2, 3] },
    data: {},
  },
  treemap: {
    props: { labelField: 'name', valueField: 'val' },
    data: { rows: [{ name: 'A', val: 1 }] },
  },
  sankey: {
    props: {},
    data: { links: [{ source: 'A', target: 'B', value: 1 }] },
  },
  scatter: {
    props: { xField: 'x', yField: 'y' },
    data: { rows: [{ x: 1, y: 2 }] },
  },
  gauge: {
    props: { value: 50, min: 0, max: 100, label: 'Utilisation' },
    data: {},
  },
  radar: {
    props: { axisField: 'a', valueField: 'v' },
    data: { rows: [{ a: 'A', v: 1 }] },
  },
  box_plot: {
    props: { groupField: 'g', valueField: 'v' },
    data: { rows: [{ g: 'A', v: 1 }] },
  },
  histogram: {
    props: { valueField: 'v' },
    data: { rows: [{ v: 1 }] },
  },
  org_chart: {
    props: { root: { id: '1', label: 'CEO' } },
    data: {},
  },
  workflow: {
    props: {
      steps: [{ label: 'Step 1', status: 'done' }],
      currentIndex: 0,
    },
    data: {},
  },
};

describe('artifact catalog', () => {
  it('has at least 30 component types', () => {
    expect(ARTIFACT_CATALOG.length).toBeGreaterThanOrEqual(30);
  });

  it('exposes a key for every catalog entry', () => {
    for (const entry of ARTIFACT_CATALOG) {
      expect(ARTIFACT_CATALOG_BY_KEY[entry.key]).toBe(entry);
    }
  });

  it('ARTIFACT_COMPONENT_TYPES matches catalog order', () => {
    expect(ARTIFACT_COMPONENT_TYPES).toEqual(
      ARTIFACT_CATALOG.map((e) => e.key),
    );
  });

  it('listArtifactTypes omits Zod schema but keeps metadata', () => {
    const list = listArtifactTypes();
    expect(list.length).toBe(ARTIFACT_CATALOG.length);
    expect(list[0]).toHaveProperty('description');
    expect(list[0]).not.toHaveProperty('schema');
  });
});

describe('catalog schemas — accept good payloads', () => {
  for (const entry of ARTIFACT_CATALOG) {
    const sample = SAMPLES[entry.key];
    it(`${entry.key} accepts a valid sample`, () => {
      const r = entry.schema.safeParse({
        component_type: entry.key,
        props: sample.props,
        data: sample.data,
      });
      if (!r.success) {
        // Aid debugging by surfacing the validation issue list.
        // eslint-disable-next-line no-console
        console.error(entry.key, r.error.issues);
      }
      expect(r.success).toBe(true);
    });
  }
});

describe('catalog schemas — reject malformed payloads', () => {
  for (const entry of ARTIFACT_CATALOG) {
    it(`${entry.key} rejects a mismatched component_type`, () => {
      const r = entry.schema.safeParse({
        component_type: 'definitely_not_a_real_type',
        props: {},
        data: {},
      });
      expect(r.success).toBe(false);
    });

    it(`${entry.key} rejects when props is not an object`, () => {
      const r = entry.schema.safeParse({
        component_type: entry.key,
        props: 'string-not-object',
        data: {},
      });
      expect(r.success).toBe(false);
    });
  }
});
