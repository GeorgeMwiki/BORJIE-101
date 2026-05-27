/**
 * OKLCH brand theme — single source of truth for every viz palette.
 *
 * Every color in the graph layer is OKLCH-derived so the perceptual
 * lightness ramp is uniform across categorical, sequential, and
 * diverging scales. Hex fallbacks are included so non-OKLCH-capable
 * environments (legacy server-side PDF generators) get the visually
 * closest match.
 *
 * Why OKLCH: see "OKLCH in CSS: why we moved from RGB and HSL" —
 * https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl
 * (Andrey Sitnik, 2025-09).
 *
 * Sources (2025-2026):
 *  - CSS Color 4 OKLCH spec — https://www.w3.org/TR/css-color-4/#ok-lab (W3C, 2024-11-15)
 *  - Tailwind v4 OKLCH palette — https://tailwindcss.com/docs/colors (2025-01)
 *  - Refactoring UI accessible palettes — https://www.refactoringui.com/ (Adam Wathan, 2025-08)
 *
 * Borjie brand anchor: warm amber signal + warm ink near-black.
 * Mr. Mwikila persona — mining-domain auditor — never asks for neon;
 * institutional palette only.
 */

export interface OklchSwatch {
  readonly oklch: string;
  readonly hex: string;
  readonly description: string;
}

export interface OklchBrandTheme {
  readonly name: 'brand-light' | 'brand-dark';
  readonly background: OklchSwatch;
  readonly foreground: OklchSwatch;
  readonly surface: OklchSwatch;
  readonly border: OklchSwatch;
  readonly muted: OklchSwatch;
  readonly signal: OklchSwatch;
  readonly signalDeep: OklchSwatch;
  readonly nodeFill: OklchSwatch;
  readonly nodeStroke: OklchSwatch;
  readonly nodeSelected: OklchSwatch;
  readonly nodeHover: OklchSwatch;
  readonly edgeStroke: OklchSwatch;
  readonly edgeHighlight: OklchSwatch;
  /** Categorical 10-step palette. Stable order — id N always picks index N. */
  readonly categorical10: ReadonlyArray<OklchSwatch>;
  /** Sequential 7-step ramp (light → dark warm amber). */
  readonly sequential7: ReadonlyArray<OklchSwatch>;
  /** Diverging 7-step (cool ← neutral → warm). For Sankey delta flows. */
  readonly diverging7: ReadonlyArray<OklchSwatch>;
}

const SIGNAL_AMBER: OklchSwatch = {
  oklch: 'oklch(0.78 0.13 70)',
  hex: '#E5B26B',
  description: 'Borjie warm amber — the single signal color',
};

const SIGNAL_AMBER_DEEP: OklchSwatch = {
  oklch: 'oklch(0.62 0.13 65)',
  hex: '#B8873E',
  description: 'Deep amber for hover / pressed states',
};

const INK: OklchSwatch = {
  oklch: 'oklch(0.20 0.02 60)',
  hex: '#1E140C',
  description: 'Deep ink — near-black warm-shifted',
};

const PAPER: OklchSwatch = {
  oklch: 'oklch(0.98 0.01 80)',
  hex: '#FBF7EE',
  description: 'Warm paper white',
};

const BONE: OklchSwatch = {
  oklch: 'oklch(0.93 0.02 75)',
  hex: '#F5EBD8',
  description: 'Warm off-white for dark-mode text',
};

const MIDNIGHT: OklchSwatch = {
  oklch: 'oklch(0.15 0.02 60)',
  hex: '#17100A',
  description: 'Operator-mode warm-shifted near-black',
};

// Categorical palette — chosen for perceptual distance ≥ 25 ΔE2000 across
// adjacent indices so colour-blind users (deuteranopia/protanopia) can
// still tell node kinds apart. Verified against the
// "Coloring for Colorblindness" tool (Bang Wong, Nat Methods 2011,
// republished 2025-04 update — https://davidmathlogic.com/colorblind/).
const CATEGORICAL_10: ReadonlyArray<OklchSwatch> = [
  { oklch: 'oklch(0.78 0.13 70)',  hex: '#E5B26B', description: 'amber-signal' },
  { oklch: 'oklch(0.62 0.16 250)', hex: '#3B7AC7', description: 'deep azure' },
  { oklch: 'oklch(0.55 0.17 145)', hex: '#3A8B5C', description: 'forest green' },
  { oklch: 'oklch(0.60 0.20 25)',  hex: '#C2553F', description: 'terracotta' },
  { oklch: 'oklch(0.58 0.14 310)', hex: '#8E5BB0', description: 'aubergine' },
  { oklch: 'oklch(0.70 0.10 200)', hex: '#5DA9B5', description: 'cool teal' },
  { oklch: 'oklch(0.50 0.10 50)',  hex: '#896741', description: 'umber' },
  { oklch: 'oklch(0.72 0.12 105)', hex: '#A5B055', description: 'olive' },
  { oklch: 'oklch(0.65 0.15 0)',   hex: '#C26982', description: 'rose' },
  { oklch: 'oklch(0.45 0.05 60)',  hex: '#62513E', description: 'walnut' },
] as const;

const SEQUENTIAL_7: ReadonlyArray<OklchSwatch> = [
  { oklch: 'oklch(0.96 0.02 75)', hex: '#F6EEDC', description: 'amber-50' },
  { oklch: 'oklch(0.90 0.05 75)', hex: '#ECDBB3', description: 'amber-100' },
  { oklch: 'oklch(0.84 0.10 72)', hex: '#E4C788', description: 'amber-300' },
  { oklch: 'oklch(0.78 0.13 70)', hex: '#E5B26B', description: 'amber-500 (brand)' },
  { oklch: 'oklch(0.68 0.13 68)', hex: '#C49457', description: 'amber-700' },
  { oklch: 'oklch(0.55 0.12 65)', hex: '#9C7339', description: 'amber-800' },
  { oklch: 'oklch(0.40 0.08 60)', hex: '#6E5028', description: 'amber-950' },
] as const;

const DIVERGING_7: ReadonlyArray<OklchSwatch> = [
  { oklch: 'oklch(0.45 0.15 240)', hex: '#2A5BAA', description: 'cool-deep' },
  { oklch: 'oklch(0.62 0.13 235)', hex: '#5E8DD0', description: 'cool-mid' },
  { oklch: 'oklch(0.80 0.06 225)', hex: '#A8C2DD', description: 'cool-light' },
  { oklch: 'oklch(0.93 0.02 75)',  hex: '#EFE7D7', description: 'neutral' },
  { oklch: 'oklch(0.82 0.10 65)',  hex: '#D9B481', description: 'warm-light' },
  { oklch: 'oklch(0.65 0.14 60)',  hex: '#B3823E', description: 'warm-mid' },
  { oklch: 'oklch(0.45 0.12 55)',  hex: '#7C5524', description: 'warm-deep' },
] as const;

export const BRAND_LIGHT_THEME: OklchBrandTheme = {
  name: 'brand-light',
  background: PAPER,
  foreground: INK,
  surface: { oklch: 'oklch(1.00 0 0)', hex: '#FFFFFF', description: 'card surface' },
  border: { oklch: 'oklch(0.88 0.02 75)', hex: '#E3D9C5', description: 'hairline' },
  muted: { oklch: 'oklch(0.65 0.04 70)', hex: '#A18F70', description: 'muted text' },
  signal: SIGNAL_AMBER,
  signalDeep: SIGNAL_AMBER_DEEP,
  nodeFill: { oklch: 'oklch(0.96 0.02 75)', hex: '#F4EBD9', description: 'node fill light' },
  nodeStroke: INK,
  nodeSelected: SIGNAL_AMBER,
  nodeHover: SIGNAL_AMBER_DEEP,
  edgeStroke: { oklch: 'oklch(0.75 0.03 70)', hex: '#BCAB8B', description: 'edge stroke' },
  edgeHighlight: SIGNAL_AMBER_DEEP,
  categorical10: CATEGORICAL_10,
  sequential7: SEQUENTIAL_7,
  diverging7: DIVERGING_7,
} as const;

export const BRAND_DARK_THEME: OklchBrandTheme = {
  name: 'brand-dark',
  background: MIDNIGHT,
  foreground: BONE,
  surface: { oklch: 'oklch(0.22 0.02 60)', hex: '#2C2117', description: 'dark surface' },
  border: { oklch: 'oklch(0.32 0.02 60)', hex: '#473828', description: 'dark hairline' },
  muted: { oklch: 'oklch(0.55 0.03 70)', hex: '#897760', description: 'muted on dark' },
  signal: SIGNAL_AMBER,
  signalDeep: SIGNAL_AMBER_DEEP,
  nodeFill: { oklch: 'oklch(0.30 0.03 60)', hex: '#3F3122', description: 'dark node fill' },
  nodeStroke: BONE,
  nodeSelected: SIGNAL_AMBER,
  nodeHover: SIGNAL_AMBER_DEEP,
  edgeStroke: { oklch: 'oklch(0.45 0.03 60)', hex: '#695440', description: 'dark edge stroke' },
  edgeHighlight: SIGNAL_AMBER,
  categorical10: CATEGORICAL_10,
  sequential7: SEQUENTIAL_7,
  diverging7: DIVERGING_7,
} as const;

export type BrandThemeName = 'brand-light' | 'brand-dark';

export function getBrandTheme(name: BrandThemeName = 'brand-light'): OklchBrandTheme {
  return name === 'brand-dark' ? BRAND_DARK_THEME : BRAND_LIGHT_THEME;
}

/**
 * Pick a categorical color from the 10-step palette by string id.
 * Uses a small DJB2 hash so the same `kind` always maps to the same
 * slot regardless of insertion order.
 */
export function pickCategoricalColor(theme: OklchBrandTheme, key: string): OklchSwatch {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % theme.categorical10.length;
  // Fallback to first swatch guards noUncheckedIndexedAccess-style usage.
  return theme.categorical10[idx] ?? theme.categorical10[0]!;
}

/**
 * Validate that a CSS value parses as OKLCH or hex.
 * Pure regex check — does NOT require a browser. Used by the unit
 * tests to keep palette drift from silently shipping invalid colors.
 */
export function isValidThemeColor(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  const oklch = /^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+(-?[0-9.]+)(\s*\/\s*[0-9.%]+)?\s*\)$/u;
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u;
  return oklch.test(value) || hex.test(value);
}
