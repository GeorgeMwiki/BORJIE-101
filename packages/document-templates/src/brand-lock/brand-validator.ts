/**
 * Brand validator — refuses non-token colours / unregistered fonts /
 * inline HTML styles before an artifact is persisted.
 *
 * This is the brand-lint gate from `DOCUMENT_COMPOSITION_SPEC.md §4
 * Layer 3` and §9 anti-patterns. The composer pipeline calls this on
 * every output before checksumming.
 */

import { isBrandColor, isBrandCssVar, isOklchInGamut, isBrandFont } from './index.js';
import type { BrandLintResult } from './index.js';

const HEX_COLOR_RE = /#[0-9a-f]{3,8}\b/gi;
const RGB_COLOR_RE = /\brgba?\(\s*[\d.,\s]+\)/gi;
const HSL_COLOR_RE = /\bhsla?\(\s*[\d.,\s%]+\)/gi;
const OKLCH_COLOR_RE = /\boklch\([^)]+\)/gi;
const CSS_VAR_RE = /var\(--[a-z0-9-]+\)/gi;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;}\n]+)/gi;
const INLINE_STYLE_RE = /\sstyle\s*=\s*["'][^"']*["']/gi;

/**
 * Validate an HTML body for brand compliance. Refuses:
 *  - hex literals not in the palette
 *  - rgb / hsl literals (must be hex / OKLCH / CSS var)
 *  - OKLCH literals outside the brand gamut
 *  - CSS vars not prefixed with an approved token name
 *  - unregistered font-family declarations
 *  - inline `style="..."` attributes
 */
export function validateHtmlBrand(html: string): BrandLintResult {
  const violations: string[] = [];

  // Inline styles — refused outright (must use registered classes).
  let m: RegExpExecArray | null;
  INLINE_STYLE_RE.lastIndex = 0;
  while ((m = INLINE_STYLE_RE.exec(html)) !== null) {
    violations.push(`inline_style:${m[0].trim().slice(0, 40)}`);
  }

  // Hex colours.
  HEX_COLOR_RE.lastIndex = 0;
  while ((m = HEX_COLOR_RE.exec(html)) !== null) {
    const c = m[0];
    if (!isBrandColor(c)) {
      violations.push(`unknown_color:${c}`);
    }
  }

  // rgb / hsl — refused (use hex / OKLCH / CSS var).
  RGB_COLOR_RE.lastIndex = 0;
  while ((m = RGB_COLOR_RE.exec(html)) !== null) {
    violations.push(`disallowed_color_form:${m[0].slice(0, 40)}`);
  }
  HSL_COLOR_RE.lastIndex = 0;
  while ((m = HSL_COLOR_RE.exec(html)) !== null) {
    violations.push(`disallowed_color_form:${m[0].slice(0, 40)}`);
  }

  // OKLCH literals — must sit in the brand gamut.
  OKLCH_COLOR_RE.lastIndex = 0;
  while ((m = OKLCH_COLOR_RE.exec(html)) !== null) {
    if (!isOklchInGamut(m[0])) {
      violations.push(`oklch_out_of_gamut:${m[0]}`);
    }
  }

  // CSS variables — must be registered.
  CSS_VAR_RE.lastIndex = 0;
  while ((m = CSS_VAR_RE.exec(html)) !== null) {
    if (!isBrandCssVar(m[0])) {
      violations.push(`unknown_css_var:${m[0]}`);
    }
  }

  // font-family declarations — must be registered.
  FONT_FAMILY_RE.lastIndex = 0;
  while ((m = FONT_FAMILY_RE.exec(html)) !== null) {
    const value = m[1];
    if (value === undefined) continue;
    if (!isBrandFont(value)) {
      violations.push(`unknown_font:${value.trim().slice(0, 40)}`);
    }
  }

  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return { ok: true };
}

/**
 * Validate a native-format colour set (DOCX/XLSX/PPTX use hex literals
 * exclusively — no CSS / OKLCH). Caller threads a flat list of every
 * fill, font-color, border, and accent the brander emitted.
 */
export function validateNativeBrandColors(
  colors: ReadonlyArray<string>,
): BrandLintResult {
  const violations: string[] = [];
  for (const c of colors) {
    if (c.length === 0) continue;
    if (!isBrandColor(c)) {
      violations.push(`unknown_color:${c}`);
    }
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return { ok: true };
}

/**
 * Validate fonts in a native artifact's emitted font list.
 */
export function validateNativeBrandFonts(
  fonts: ReadonlyArray<string>,
): BrandLintResult {
  const violations: string[] = [];
  for (const f of fonts) {
    if (f.length === 0) continue;
    if (!isBrandFont(f)) {
      violations.push(`unknown_font:${f}`);
    }
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return { ok: true };
}
