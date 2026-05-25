import { describe, expect, it } from 'vitest';
import {
  barChart,
  boxplotChart,
  funnelChart,
  gaugeChart,
  heatmapChart,
  kpiTile,
  lineChart,
  mapChart,
  pieChart,
  sankeyChart,
  scatterChart,
  VEGA_LITE_V6_SCHEMA,
} from '../charts/index.js';
import { validateChartSpec } from '../types.js';

const data = [
  { month: '2026-01', amount: 100, status: 'active', region: 'KE' },
  { month: '2026-02', amount: 200, status: 'cancelled', region: 'TZ' },
];

describe('charts / builders — each kind produces a valid Vega-Lite v6 spec', () => {
  it('lineChart', () => {
    const spec = lineChart({ data, x: 'month', y: 'amount', title: 'Trend' });
    expect(spec.$schema).toBe(VEGA_LITE_V6_SCHEMA);
    expect(validateChartSpec(spec).ok).toBe(true);
    expect(spec.title).toEqual('Trend');
  });

  it('lineChart with color + facet', () => {
    const spec = lineChart({ data, x: 'month', y: 'amount', color: 'status', facet: 'region' });
    const enc = spec.encoding as Record<string, unknown>;
    expect((enc['color'] as Record<string, unknown>)['field']).toBe('status');
    expect((spec.facet as Record<string, unknown>)['field']).toBe('region');
  });

  it('barChart vertical', () => {
    const spec = barChart({ data, x: 'status', y: 'amount' });
    expect(validateChartSpec(spec).ok).toBe(true);
    const enc = spec.encoding as Record<string, unknown>;
    expect((enc['x'] as Record<string, unknown>)['field']).toBe('status');
  });

  it('barChart horizontal swaps axes', () => {
    const spec = barChart({ data, x: 'status', y: 'amount', orientation: 'horizontal' });
    const enc = spec.encoding as Record<string, unknown>;
    expect((enc['y'] as Record<string, unknown>)['field']).toBe('status');
    expect((enc['x'] as Record<string, unknown>)['field']).toBe('amount');
  });

  it('pieChart with donut innerRadius', () => {
    const spec = pieChart({ data, category: 'status', value: 'amount', innerRadius: 40 });
    expect(validateChartSpec(spec).ok).toBe(true);
    const mark = spec.mark as Record<string, unknown>;
    expect(mark['innerRadius']).toBe(40);
  });

  it('scatterChart with size + color', () => {
    const spec = scatterChart({ data, x: 'amount', y: 'amount', color: 'status', size: 'amount' });
    expect(validateChartSpec(spec).ok).toBe(true);
    const enc = spec.encoding as Record<string, unknown>;
    expect(enc['size']).toBeDefined();
  });

  it('heatmapChart uses rect mark', () => {
    const spec = heatmapChart({ data, x: 'month', y: 'region', value: 'amount' });
    expect(validateChartSpec(spec).ok).toBe(true);
    const mark = spec.mark as Record<string, unknown>;
    expect(mark['type']).toBe('rect');
  });

  it('mapChart emits projection', () => {
    const spec = mapChart({ data, region: 'region', value: 'amount', projectionType: 'equalEarth' });
    expect(validateChartSpec(spec).ok).toBe(true);
    expect((spec.projection as Record<string, unknown>)['type']).toBe('equalEarth');
  });

  it('funnelChart is a sorted horizontal bar', () => {
    const spec = funnelChart({ data, stage: 'status', value: 'amount' });
    expect(validateChartSpec(spec).ok).toBe(true);
    const enc = spec.encoding as Record<string, unknown>;
    expect((enc['y'] as Record<string, unknown>)['sort']).toBe('-x');
  });

  it('gaugeChart clamps fraction to [0,1]', () => {
    const a = gaugeChart({ data: [], value: 50, min: 0, max: 100 });
    expect(validateChartSpec(a).ok).toBe(true);
    const values = (a.data.values ?? []) as Array<{ value: number }>;
    expect(values[0]?.value).toBe(0.5);
    expect(values[1]?.value).toBe(0.5);
    // Out-of-range value gets clamped.
    const b = gaugeChart({ data: [], value: 999, min: 0, max: 100 });
    const vb = (b.data.values ?? []) as Array<{ value: number }>;
    expect(vb[0]?.value).toBe(1);
  });

  it('sankeyChart carries the sankey params marker', () => {
    const spec = sankeyChart({ data, source: 'status', target: 'region', value: 'amount' });
    const params = (spec['params'] as Array<{ name: string; value: unknown }>);
    expect(params.find((p) => p.name === 'sankey')?.value).toBe(true);
  });

  it('boxplotChart emits boxplot mark', () => {
    const spec = boxplotChart({ data, category: 'status', value: 'amount' });
    expect(validateChartSpec(spec).ok).toBe(true);
    const mark = spec.mark as Record<string, unknown>;
    expect(mark['type']).toBe('boxplot');
  });

  it('all 10 builders emit v6 schema URL', () => {
    const specs = [
      lineChart({ data, x: 'month', y: 'amount' }),
      barChart({ data, x: 'status', y: 'amount' }),
      pieChart({ data, category: 'status', value: 'amount' }),
      scatterChart({ data, x: 'amount', y: 'amount' }),
      heatmapChart({ data, x: 'month', y: 'region', value: 'amount' }),
      mapChart({ data, region: 'region', value: 'amount' }),
      funnelChart({ data, stage: 'status', value: 'amount' }),
      gaugeChart({ data: [], value: 50, min: 0, max: 100 }),
      sankeyChart({ data, source: 'status', target: 'region', value: 'amount' }),
      boxplotChart({ data, category: 'status', value: 'amount' }),
    ];
    for (const s of specs) {
      expect(s.$schema).toBe(VEGA_LITE_V6_SCHEMA);
      expect(validateChartSpec(s).ok).toBe(true);
    }
  });

  it('kpiTile returns a kpi tile struct', () => {
    const t = kpiTile({ title: 'Revenue', value: 1234, format: 'currency', delta: 0.1 });
    expect(t.kind).toBe('kpi');
    expect(t.value).toBe(1234);
  });

  it('validateChartSpec rejects an obviously broken spec', () => {
    const r = validateChartSpec({ description: 'no data, no mark' });
    expect(r.ok).toBe(false);
  });
});
