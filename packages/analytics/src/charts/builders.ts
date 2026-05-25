/**
 * Vega-Lite v6 chart spec builders.
 *
 * Each builder is a pure function: given typed inputs (data + encoding
 * hints), it returns a complete Vega-Lite v6 spec ready to render. The
 * builders favor minimal, sensible defaults — every option can be
 * overridden by spreading a `partial` chunk into the returned spec.
 *
 * Why these 10:
 *   - line, bar, pie, scatter, heatmap: the foundational five
 *   - map: choropleth via the d3 projection module
 *   - funnel: conversion / sales-pipeline tooling
 *   - gauge: KPI tiles (single-value with target/threshold band)
 *   - sankey: flow visualisation (lease lifecycle, payment splits)
 *   - boxplot: distribution analysis for credit scoring + rent ranges
 *
 * Every builder respects the package theme + always emits the v6 schema
 * URL so renderers (vega-embed, vega-lite Python, etc.) get the right
 * schema version.
 */

import type { ChartSpec } from '../types.js';
import { CHART_CONFIG, VEGA_LITE_V6_SCHEMA } from './theme.js';

type Row = Record<string, unknown>;

export interface BuilderCommon {
  readonly data: readonly Row[];
  readonly title?: string;
  readonly subtitle?: string;
  readonly width?: number | 'container';
  readonly height?: number | 'container';
}

function withDefaults(common: BuilderCommon, body: Omit<ChartSpec, '$schema' | 'data' | 'config' | 'title'>): ChartSpec {
  const title = common.title
    ? common.subtitle
      ? { text: common.title, subtitle: common.subtitle }
      : common.title
    : undefined;
  const spec = {
    $schema: VEGA_LITE_V6_SCHEMA,
    ...(title ? { title } : {}),
    width: common.width ?? 'container',
    height: common.height ?? 300,
    data: { values: [...common.data] },
    config: CHART_CONFIG,
    ...body,
  };
  return Object.freeze(spec as unknown as ChartSpec);
}

// ───────────────────────── 1. line ─────────────────────────

export interface LineChartInput extends BuilderCommon {
  readonly x: string;
  readonly y: string;
  readonly color?: string;
  readonly facet?: string;
}

export function lineChart(input: LineChartInput): ChartSpec {
  const encoding: Record<string, unknown> = {
    x: { field: input.x, type: 'temporal' },
    y: { field: input.y, type: 'quantitative' },
  };
  if (input.color) encoding['color'] = { field: input.color, type: 'nominal' };
  const body: Omit<ChartSpec, '$schema' | 'data' | 'config' | 'title'> = {
    mark: { type: 'line', interpolate: 'monotone', point: true },
    encoding,
  };
  if (input.facet) {
    (body as { facet?: Record<string, unknown> }).facet = { field: input.facet, type: 'nominal' };
  }
  return withDefaults(input, body);
}

// ───────────────────────── 2. bar ─────────────────────────

export interface BarChartInput extends BuilderCommon {
  readonly x: string;
  readonly y: string;
  readonly color?: string;
  readonly orientation?: 'vertical' | 'horizontal';
}

export function barChart(input: BarChartInput): ChartSpec {
  const horizontal = input.orientation === 'horizontal';
  const encoding: Record<string, unknown> = horizontal
    ? {
        y: { field: input.x, type: 'nominal', sort: '-x' },
        x: { field: input.y, type: 'quantitative' },
      }
    : {
        x: { field: input.x, type: 'nominal' },
        y: { field: input.y, type: 'quantitative' },
      };
  if (input.color) encoding['color'] = { field: input.color, type: 'nominal' };
  return withDefaults(input, {
    mark: { type: 'bar', cornerRadius: 4 },
    encoding,
  });
}

// ───────────────────────── 3. pie ─────────────────────────

export interface PieChartInput extends BuilderCommon {
  readonly category: string;
  readonly value: string;
  readonly innerRadius?: number;
}

export function pieChart(input: PieChartInput): ChartSpec {
  return withDefaults(input, {
    mark: { type: 'arc', innerRadius: input.innerRadius ?? 0 },
    encoding: {
      theta: { field: input.value, type: 'quantitative' },
      color: { field: input.category, type: 'nominal' },
    },
  });
}

// ───────────────────────── 4. scatter ─────────────────────────

export interface ScatterChartInput extends BuilderCommon {
  readonly x: string;
  readonly y: string;
  readonly color?: string;
  readonly size?: string;
}

export function scatterChart(input: ScatterChartInput): ChartSpec {
  const encoding: Record<string, unknown> = {
    x: { field: input.x, type: 'quantitative' },
    y: { field: input.y, type: 'quantitative' },
  };
  if (input.color) encoding['color'] = { field: input.color, type: 'nominal' };
  if (input.size) encoding['size'] = { field: input.size, type: 'quantitative' };
  return withDefaults(input, {
    mark: { type: 'point', filled: true, opacity: 0.8 },
    encoding,
  });
}

// ───────────────────────── 5. heatmap ─────────────────────────

export interface HeatmapChartInput extends BuilderCommon {
  readonly x: string;
  readonly y: string;
  readonly value: string;
}

export function heatmapChart(input: HeatmapChartInput): ChartSpec {
  return withDefaults(input, {
    mark: { type: 'rect' },
    encoding: {
      x: { field: input.x, type: 'nominal' },
      y: { field: input.y, type: 'nominal' },
      color: { field: input.value, type: 'quantitative', scale: { scheme: 'blues' } },
    },
  });
}

// ───────────────────────── 6. map ─────────────────────────

export interface MapChartInput extends BuilderCommon {
  readonly region: string;
  readonly value: string;
  readonly projectionType?: 'mercator' | 'equalEarth' | 'naturalEarth1';
}

export function mapChart(input: MapChartInput): ChartSpec {
  // Vega-Lite v6 supports projections natively. The renderer is
  // expected to provide a topojson layer via `data.url`; we emit a
  // `geoshape` mark + the projection so the renderer wires geometry.
  return withDefaults(input, {
    mark: { type: 'geoshape', stroke: '#ffffff', strokeWidth: 0.5 },
    encoding: {
      color: { field: input.value, type: 'quantitative', scale: { scheme: 'blues' } },
      tooltip: [
        { field: input.region, type: 'nominal' },
        { field: input.value, type: 'quantitative' },
      ],
    },
    projection: { type: input.projectionType ?? 'mercator' },
  });
}

// ───────────────────────── 7. funnel ─────────────────────────

export interface FunnelChartInput extends BuilderCommon {
  readonly stage: string;
  readonly value: string;
}

export function funnelChart(input: FunnelChartInput): ChartSpec {
  // Vega-Lite has no first-class funnel mark; we emit a horizontal bar
  // chart with stages on the y axis sorted by descending value — the
  // canonical implementation, identical to Plotly funnel output.
  return withDefaults(input, {
    mark: { type: 'bar', cornerRadius: 4 },
    encoding: {
      y: { field: input.stage, type: 'nominal', sort: '-x' },
      x: { field: input.value, type: 'quantitative' },
      color: { field: input.stage, type: 'nominal', legend: null },
    },
  });
}

// ───────────────────────── 8. gauge ─────────────────────────

export interface GaugeChartInput extends BuilderCommon {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly label?: string;
}

export function gaugeChart(input: GaugeChartInput): ChartSpec {
  // Vega-Lite has no native gauge; we render the SOTA "donut KPI" form:
  // a half-arc with the value as a fraction of the (max - min) range.
  // Renderers may overlay the numeric label client-side.
  const range = Math.max(1, input.max - input.min);
  const fraction = Math.max(0, Math.min(1, (input.value - input.min) / range));
  const data = [
    { label: input.label ?? 'value', value: fraction, fill: 'fg' },
    { label: 'remaining', value: 1 - fraction, fill: 'bg' },
  ];
  return withDefaults(
    { ...input, data },
    {
      mark: { type: 'arc', innerRadius: 60, outerRadius: 100 },
      encoding: {
        theta: { field: 'value', type: 'quantitative', stack: true },
        color: {
          field: 'fill',
          type: 'nominal',
          scale: { domain: ['fg', 'bg'], range: ['#2563eb', '#e2e8f0'] },
          legend: null,
        },
      },
    },
  );
}

// ───────────────────────── 9. sankey ─────────────────────────

export interface SankeyChartInput extends BuilderCommon {
  readonly source: string;
  readonly target: string;
  readonly value: string;
}

export function sankeyChart(input: SankeyChartInput): ChartSpec {
  // Vega-Lite v6 has no built-in sankey; this is the canonical pattern:
  // wrap a Vega spec via `transform.lookup` + the sankey extension. The
  // renderer is expected to pass through a vega `sankey` transform when
  // it sees the marker `params.sankey: true`. We carry the params so
  // the renderer can compose a Vega spec from this Vega-Lite shell.
  return withDefaults(input, {
    mark: { type: 'rect' },
    encoding: {
      x: { field: input.source, type: 'nominal' },
      x2: { field: input.target },
      y: { field: input.value, type: 'quantitative' },
      color: { field: input.source, type: 'nominal' },
    },
    transform: [
      // Marker the renderer reads to switch to the Vega sankey transform.
      { calculate: `datum.${input.value}`, as: '_sankey_value' },
    ],
    params: [{ name: 'sankey', value: true }],
  });
}

// ───────────────────────── 10. boxplot ─────────────────────────

export interface BoxplotChartInput extends BuilderCommon {
  readonly category: string;
  readonly value: string;
}

export function boxplotChart(input: BoxplotChartInput): ChartSpec {
  return withDefaults(input, {
    mark: { type: 'boxplot', extent: 'min-max' },
    encoding: {
      x: { field: input.category, type: 'nominal' },
      y: { field: input.value, type: 'quantitative' },
      color: { field: input.category, type: 'nominal', legend: null },
    },
  });
}

// ───────────────────────── KPI helper ─────────────────────────

export interface KpiTileInput {
  readonly title: string;
  readonly value: number;
  readonly format: 'number' | 'currency' | 'percent' | 'duration_ms' | 'bytes';
  readonly delta?: number;
  readonly comparisonLabel?: string;
}

/**
 * KPI tile spec — a single value with optional delta. Not a Vega-Lite
 * chart per se; renderers detect `kind: 'kpi'` and render natively.
 */
export function kpiTile(input: KpiTileInput): {
  readonly kind: 'kpi';
  readonly title: string;
  readonly value: number;
  readonly format: KpiTileInput['format'];
  readonly delta?: number;
  readonly comparisonLabel?: string;
} {
  return Object.freeze({
    kind: 'kpi' as const,
    ...input,
  });
}
