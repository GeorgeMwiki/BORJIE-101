/**
 * Color scales — deterministic interpolators.
 *
 * Continuous: viridis, plasma, rdylgn.
 * Categorical: categorical-12 (a 12-step qualitative palette).
 *
 * Implementations are intentionally compact; we sample at fixed
 * breakpoints and linearly interpolate in RGB space. For production
 * cartography use d3-scale-chromatic; this is sufficient for the
 * deterministic test fixtures and on-device rendering.
 */

import type { ColorScaleId } from '../types.js';

type RGB = readonly [number, number, number];

const VIRIDIS_STOPS: ReadonlyArray<RGB> = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

const PLASMA_STOPS: ReadonlyArray<RGB> = [
  [13, 8, 135],
  [126, 3, 168],
  [203, 70, 121],
  [248, 149, 64],
  [240, 249, 33],
];

const RDYLGN_STOPS: ReadonlyArray<RGB> = [
  [165, 0, 38],
  [244, 109, 67],
  [255, 255, 191],
  [102, 189, 99],
  [0, 104, 55],
];

const CATEGORICAL_12: ReadonlyArray<string> = [
  '#1f77b4',
  '#ff7f0e',
  '#2ca02c',
  '#d62728',
  '#9467bd',
  '#8c564b',
  '#e377c2',
  '#7f7f7f',
  '#bcbd22',
  '#17becf',
  '#aec7e8',
  '#ffbb78',
];

function rgbToHex(rgb: RGB): string {
  const toHex = (n: number): string => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

function interpolate(stops: ReadonlyArray<RGB>, t: number): string {
  if (stops.length === 0) return '#000000';
  if (stops.length === 1) {
    const only = stops[0] as RGB;
    return rgbToHex(only);
  }
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (stops.length - 1);
  const idx = Math.floor(scaled);
  const frac = scaled - idx;
  const a = (stops[idx] ?? stops[0]) as RGB;
  const b = (stops[Math.min(idx + 1, stops.length - 1)] ?? a) as RGB;
  const mix: RGB = [
    a[0] + (b[0] - a[0]) * frac,
    a[1] + (b[1] - a[1]) * frac,
    a[2] + (b[2] - a[2]) * frac,
  ];
  return rgbToHex(mix);
}

/**
 * Sample a continuous color scale at t in [0,1]. For categorical scales
 * use `sampleCategorical()`.
 */
export function sampleScale(scaleId: ColorScaleId, t: number): string {
  switch (scaleId) {
    case 'viridis':
      return interpolate(VIRIDIS_STOPS, t);
    case 'plasma':
      return interpolate(PLASMA_STOPS, t);
    case 'rdylgn':
      return interpolate(RDYLGN_STOPS, t);
    case 'categorical-12':
      return sampleCategorical(Math.floor(t * CATEGORICAL_12.length));
    default:
      return '#888888';
  }
}

export function sampleCategorical(index: number): string {
  if (CATEGORICAL_12.length === 0) return '#888888';
  const i = ((index % CATEGORICAL_12.length) + CATEGORICAL_12.length) % CATEGORICAL_12.length;
  return CATEGORICAL_12[i] as string;
}

/**
 * Normalize a value to [0,1] using min/max from a series.
 */
export function normalizeToScale(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}
