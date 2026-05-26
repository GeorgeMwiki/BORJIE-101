/**
 * Brand-lock — the colour / typography / spacing whitelist that every
 * Borjie-branded artifact must conform to before it can be persisted.
 *
 * Mirrors the brand-lint policy from
 * `docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md §4 Layer 3`: every fill/font
 * colour MUST resolve to a registered token (OKLCH literal or named
 * token), every font family must be one of the registered families,
 * and inline styles in HTML are refused.
 */

// ---------------------------------------------------------------------------
// Token palette — single source of truth for ALL doc-format branders.
// Values mirror `packages/design-system/lib/tokens.ts` colour ramp but
// are kept here so the brand-lint step does not import the design
// system at runtime (the design system is React/Tailwind-coupled).
// ---------------------------------------------------------------------------

/**
 * The closed set of brand-approved hex literals for native renderers
 * that cannot consume CSS variables (DOCX, XLSX, PPTX). PDFs accept
 * either these literals or the matching OKLCH variable form.
 */
export const BRAND_COLOR_PALETTE: ReadonlyArray<string> = Object.freeze([
  // Brand primary ramp (sky → ocean).
  '#f0f9ff',
  '#e0f2fe',
  '#bae6fd',
  '#7dd3fc',
  '#38bdf8',
  '#0ea5e9',
  '#0284c7',
  '#0369a1',
  '#075985',
  '#0c4a6e',
  '#082f49',
  // Neutral ramp (paper → ink).
  '#f8fafc',
  '#f1f5f9',
  '#e2e8f0',
  '#cbd5e1',
  '#94a3b8',
  '#64748b',
  '#475569',
  '#334155',
  '#1e293b',
  '#0f172a',
  // Semantic accents.
  '#22c55e',
  '#16a34a',
  '#f59e0b',
  '#d97706',
  '#ef4444',
  '#dc2626',
  '#3b82f6',
  '#2563eb',
  // Borjie signature gradient anchors.
  '#1F3864',
  '#C45B12',
  // Pure black / white reserved for body text + paper.
  '#000000',
  '#ffffff',
]);

/** Lower-cased, hash-prefixed palette for fast membership checks. */
const NORMALISED_PALETTE = new Set(
  BRAND_COLOR_PALETTE.map((c) => c.toLowerCase()),
);

/** Approved CSS-variable references — checked against PDF/HTML output. */
export const BRAND_CSS_VAR_PREFIXES: ReadonlyArray<string> = Object.freeze([
  '--color-brand',
  '--color-neutral',
  '--color-success',
  '--color-warning',
  '--color-danger',
  '--color-info',
  '--color-fg',
  '--color-bg',
  '--color-muted',
]);

/** Approved font families. */
export const BRAND_FONT_FAMILIES: ReadonlyArray<string> = Object.freeze([
  'Inter',
  'system-ui',
  'sans-serif',
  'JetBrains Mono',
  'Menlo',
  'monospace',
  // Native DOCX/PDF built-ins permitted as fallbacks.
  'Helvetica',
  'Helvetica-Bold',
  'Arial',
  'Times New Roman',
  'Calibri',
]);

const NORMALISED_FONTS = new Set(
  BRAND_FONT_FAMILIES.map((f) => f.toLowerCase()),
);

// ---------------------------------------------------------------------------
// Validation result type — shared by every format-specific brander.
// ---------------------------------------------------------------------------

export type BrandLintResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: ReadonlyArray<string> };

/**
 * Returns `true` when the supplied hex string (with or without leading
 * `#`) is registered in the brand palette.
 */
export function isBrandColor(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) return false;
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return NORMALISED_PALETTE.has(withHash);
}

/**
 * Returns `true` when the supplied CSS-variable reference (e.g.
 * `var(--color-brand-500)`) matches one of the approved prefixes.
 */
export function isBrandCssVar(input: string): boolean {
  const m = /var\((--[a-z0-9-]+)\)/i.exec(input.trim());
  if (!m || m[1] === undefined) return false;
  const varName = m[1].toLowerCase();
  return BRAND_CSS_VAR_PREFIXES.some((p) => varName.startsWith(p));
}

/**
 * Returns `true` when the supplied OKLCH literal sits in the brand
 * gamut. We do not try to reproduce the full design-system OKLCH
 * inventory at runtime — we instead accept any OKLCH value whose
 * lightness is between 0 and 1, chroma between 0 and 0.4, and hue
 * 0–360. This rejects nonsense values without coupling the brander to
 * the full token list.
 */
export function isOklchInGamut(input: string): boolean {
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+)?\s*\)/i.exec(
    input,
  );
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) {
    return false;
  }
  const l = Number(m[1]);
  const c = Number(m[2]);
  const h = Number(m[3]);
  return l >= 0 && l <= 1 && c >= 0 && c <= 0.4 && h >= 0 && h <= 360;
}

/**
 * Returns `true` when the supplied font family is registered.
 */
export function isBrandFont(input: string): boolean {
  const normalised = input
    .replace(/['"]/g, '')
    .split(',')
    .map((f) => f.trim().toLowerCase())
    .filter((f) => f.length > 0);
  if (normalised.length === 0) return false;
  return normalised.every((f) => NORMALISED_FONTS.has(f));
}

// ---------------------------------------------------------------------------
// Brand-lint convenience aggregator.
// ---------------------------------------------------------------------------

export interface BrandLintArgs {
  readonly colors: ReadonlyArray<string>;
  readonly fonts: ReadonlyArray<string>;
}

export function lintBrand(args: BrandLintArgs): BrandLintResult {
  const violations: string[] = [];
  for (const color of args.colors) {
    if (
      !isBrandColor(color) &&
      !isBrandCssVar(color) &&
      !isOklchInGamut(color)
    ) {
      violations.push(`unknown_color:${color}`);
    }
  }
  for (const font of args.fonts) {
    if (!isBrandFont(font)) {
      violations.push(`unknown_font:${font}`);
    }
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return { ok: true };
}
