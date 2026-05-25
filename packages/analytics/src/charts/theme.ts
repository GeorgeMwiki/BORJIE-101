/**
 * Pre-shipped chart theme — colors matching admin-portal tokens.
 *
 * These are picked once (not derived from the dataset) so dashboards
 * have a coherent look across widgets. The token set tracks the
 * design-system OKLCH palette: ten categorical colors, plus a diverging
 * scale + a sequential scale.
 */

export const CATEGORICAL_PALETTE: readonly string[] = [
  '#2563eb', // blue 600
  '#10b981', // emerald 500
  '#f59e0b', // amber 500
  '#ef4444', // red 500
  '#8b5cf6', // violet 500
  '#06b6d4', // cyan 500
  '#84cc16', // lime 500
  '#ec4899', // pink 500
  '#f97316', // orange 500
  '#64748b', // slate 500
];

export const SEQUENTIAL_PALETTE: readonly string[] = [
  '#dbeafe',
  '#bfdbfe',
  '#93c5fd',
  '#60a5fa',
  '#3b82f6',
  '#2563eb',
  '#1d4ed8',
  '#1e40af',
  '#1e3a8a',
];

export const DIVERGING_PALETTE: readonly string[] = [
  '#ef4444',
  '#fb923c',
  '#fcd34d',
  '#f0fdf4',
  '#86efac',
  '#22c55e',
  '#15803d',
];

export const CHART_CONFIG: Record<string, unknown> = {
  background: 'transparent',
  view: { stroke: 'transparent' },
  axis: {
    labelColor: '#475569',
    titleColor: '#1e293b',
    titleFontSize: 12,
    labelFontSize: 11,
    grid: true,
    gridColor: '#e2e8f0',
    domainColor: '#cbd5e1',
  },
  legend: {
    labelColor: '#475569',
    titleColor: '#1e293b',
  },
  title: {
    color: '#0f172a',
    subtitleColor: '#475569',
    fontSize: 14,
    subtitleFontSize: 12,
    anchor: 'start',
  },
  range: {
    category: CATEGORICAL_PALETTE as string[],
    heatmap: SEQUENTIAL_PALETTE as string[],
    ramp: SEQUENTIAL_PALETTE as string[],
    diverging: DIVERGING_PALETTE as string[],
  },
};

export const VEGA_LITE_V6_SCHEMA = 'https://vega.github.io/schema/vega-lite/v6.json';
