/**
 * Brand-token runtime validator (Layer 3 enforcement).
 *
 * Source of truth: `Docs/DESIGN/ANTICIPATORY_UX_SPEC.md` §6.
 *
 * Validates that an incoming UiPart payload — composed by Mr. Mwikila —
 * carries ONLY brand-locked style references. Anything that would slip
 * a raw color literal, an inline style with arbitrary units, or a
 * Tailwind arbitrary value into the rendered surface is rejected. The
 * caller routes rejected payloads to `UnknownKindCard(malformed: true)`
 * via the existing `schema-validation-failed` hook in
 * `packages/genui/src/AdaptiveRenderer.tsx`.
 *
 * Acceptance rules — what passes:
 *
 *   1. `className` strings that compose ONLY of:
 *      - the Tailwind token scale (`gap-4`, `p-2`, `text-sm`, `rounded-md`,
 *        `shadow-md`, `bg-signal-500`, `text-foreground`, …)
 *      - a layout / state utility (`flex`, `grid`, `items-center`,
 *        `cursor-pointer`, `hover:bg-…`, …)
 *      - a registered design-system alias (`bg-surface`, `bg-card`, …)
 *
 *   2. Inline `style` objects whose values resolve to:
 *      - `'transparent' | 'currentColor' | 'inherit' | 'unset'`,
 *      - a CSS variable reference `var(--…)`,
 *      - a `hsl(var(--…))` / `rgb(var(--…))` / `oklch(var(--…))` expression
 *        wrapping a token reference,
 *      - a pure-number value for layout (`zIndex: 10`, `lineHeight: 1.4`),
 *      - empty string / `null` / `undefined` (no-op).
 *
 * Rejection rules — what fails:
 *
 *   - Tailwind arbitrary values: `gap-[17px]`, `p-[3rem]`, `text-[#ff0000]`,
 *     `bg-[#123456]`, `rounded-[8px]`, `shadow-[…]`.
 *   - Raw hex / rgb / hsl literals in `className` or `style`.
 *   - Named CSS colors (`red`, `blue`, `crimson`, …) in `style`.
 *   - Inline `style={…}` props that pass raw literals through to the
 *     DOM (caught by the same regex set as `className`).
 *
 * Implementation discipline:
 *   - Pure function: same input → same output. No I/O.
 *   - Walks the UiPart payload depth-first, accumulating string
 *     violations. Returns ALL violations, not just the first, so the
 *     authoring surface can surface a complete remediation list.
 */

import type { BrandValidationResult } from './types.js';

// ---------------------------------------------------------------------------
// Allowlist / denylist regex set
// ---------------------------------------------------------------------------

/**
 * Reject any Tailwind arbitrary value `<utility>-[<anything>]`.
 *
 * Example matches: `gap-[17px]`, `p-[3rem]`, `text-[#ff0000]`,
 * `bg-[oklch(0.5_0.1_45)]`, `rounded-[8px]`.
 */
const RE_TW_ARBITRARY = /(^|[\s])[a-z][a-z0-9-]*\[[^\]]+\]/i;

/**
 * Reject raw hex literals — `#abc`, `#abcdef`, `#abcdefab` — appearing
 * ANYWHERE in a string (className or style value).
 */
const RE_RAW_HEX = /#[0-9a-f]{3,8}\b/i;

/** Reject `rgb(…)` and `rgba(…)` literals. */
const RE_RAW_RGB = /\brgba?\s*\(/i;

/**
 * Reject `hsl(…)` literals UNLESS they wrap a CSS variable reference.
 *
 *   hsl(var(--signal-500))         ← OK
 *   hsl(30 72% 52%)                ← REJECTED
 *   hsl(var(--signal-500) / 0.5)   ← OK
 */
const RE_RAW_HSL_LITERAL = /\bhsla?\s*\(\s*(?!var\s*\()/i;

/**
 * Reject `oklch(…)` literals UNLESS they wrap a CSS variable reference.
 */
const RE_RAW_OKLCH_LITERAL = /\boklch\s*\(\s*(?!var\s*\()/i;

/**
 * Named CSS color denylist — the common ones that authors reach for
 * by accident. Not exhaustive (the spec keeps the validator
 * mechanical; the ESLint rule is the comprehensive belt-and-braces in
 * §6.2). The runtime check guards the obvious mistakes.
 */
const NAMED_COLORS = new Set([
  'red',
  'blue',
  'green',
  'yellow',
  'orange',
  'purple',
  'pink',
  'cyan',
  'magenta',
  'crimson',
  'salmon',
  'gold',
  'silver',
  'maroon',
  'navy',
  'teal',
  'olive',
  'lime',
  'fuchsia',
  'aqua',
  'indigo',
  'violet',
  'turquoise',
  'coral',
  'khaki',
  'plum',
  'tan',
  'beige',
  'azure',
  'ivory',
  'lavender',
  'mint',
  'peach',
  'tomato',
]);

/**
 * CSS property keys whose value must resolve to a brand token. Anything
 * else (`zIndex`, `lineHeight`, `flexGrow`, …) is allowed through.
 */
const STYLE_PROPS_BRAND_GATED = new Set([
  'color',
  'background',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'textDecorationColor',
  'fill',
  'stroke',
  'caretColor',
  'columnRuleColor',
  'gap',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'borderRadius',
  'boxShadow',
  'fontFamily',
]);

/** Allowlisted special style values (no token resolution needed). */
const STYLE_VALUE_ALLOWLIST = new Set([
  'transparent',
  'currentColor',
  'currentcolor',
  'inherit',
  'unset',
  'initial',
  'revert',
  'auto',
  'none',
  '0',
]);

// ---------------------------------------------------------------------------
// String-level checks
// ---------------------------------------------------------------------------

function classNameViolations(value: string, path: string): ReadonlyArray<string> {
  const violations: string[] = [];
  if (RE_TW_ARBITRARY.test(value)) {
    violations.push(
      `${path}: Tailwind arbitrary value rejected ('${value.trim()}')`,
    );
  }
  if (RE_RAW_HEX.test(value)) {
    violations.push(`${path}: raw hex color rejected ('${value.trim()}')`);
  }
  if (RE_RAW_RGB.test(value)) {
    violations.push(`${path}: raw rgb()/rgba() rejected ('${value.trim()}')`);
  }
  if (RE_RAW_HSL_LITERAL.test(value)) {
    violations.push(
      `${path}: raw hsl()/hsla() literal rejected — wrap in var() reference ('${value.trim()}')`,
    );
  }
  if (RE_RAW_OKLCH_LITERAL.test(value)) {
    violations.push(
      `${path}: raw oklch() literal rejected — wrap in var() reference ('${value.trim()}')`,
    );
  }
  return violations;
}

function styleValueViolations(
  key: string,
  raw: unknown,
  path: string,
): ReadonlyArray<string> {
  const fieldPath = `${path}.${key}`;
  if (raw === null || raw === undefined || raw === '') {
    return [];
  }
  // Numeric values are layout-safe — `zIndex: 10`, `lineHeight: 1.4`.
  if (typeof raw === 'number') {
    return [];
  }
  if (typeof raw !== 'string') {
    return [`${fieldPath}: style value must be string|number|null, got ${typeof raw}`];
  }
  const value = raw.trim();
  if (value === '') {
    return [];
  }
  if (STYLE_VALUE_ALLOWLIST.has(value)) {
    return [];
  }
  // Token reference shapes — accepted as-is.
  if (/^var\s*\(\s*--[a-z0-9-]+(\s*,\s*[^)]+)?\)$/i.test(value)) {
    return [];
  }
  if (
    /^(hsla?|rgba?|oklch)\s*\(\s*var\s*\(\s*--[a-z0-9-]+(\s*,\s*[^)]+)?\)/i.test(value)
  ) {
    return [];
  }
  const violations: string[] = [];
  if (RE_RAW_HEX.test(value)) {
    violations.push(`${fieldPath}: raw hex color rejected ('${value}')`);
  }
  if (RE_RAW_RGB.test(value)) {
    violations.push(`${fieldPath}: raw rgb()/rgba() rejected ('${value}')`);
  }
  if (RE_RAW_HSL_LITERAL.test(value)) {
    violations.push(
      `${fieldPath}: raw hsl()/hsla() literal rejected — wrap in var() reference ('${value}')`,
    );
  }
  if (RE_RAW_OKLCH_LITERAL.test(value)) {
    violations.push(
      `${fieldPath}: raw oklch() literal rejected — wrap in var() reference ('${value}')`,
    );
  }
  if (NAMED_COLORS.has(value.toLowerCase())) {
    violations.push(
      `${fieldPath}: named CSS color rejected ('${value}') — use a design-system token`,
    );
  }
  // Brand-gated property must resolve to a token or allowlisted special
  // value; if we haven't seen a recognised shape by now, flag it.
  if (STYLE_PROPS_BRAND_GATED.has(key) && violations.length === 0) {
    if (!value.includes('var(--')) {
      violations.push(
        `${fieldPath}: brand-gated style property '${key}' must reference a design-system token ('${value}')`,
      );
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Recursive walk
// ---------------------------------------------------------------------------

/**
 * Walk a UiPart payload depth-first, accumulating violations. We treat
 * any object key named `className`, `class`, `style`, `theme`, `color`,
 * `background`, `style`, `cssText` as potentially style-bearing.
 *
 * Unknown nested shapes are walked too — a Tab Recipe can ship deeply
 * nested groups + arrays of fields, so we cannot bail at the first
 * level.
 */
function walk(node: unknown, path: string, violations: string[]): void {
  if (node === null || node === undefined) {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, idx) => walk(item, `${path}[${idx}]`, violations));
    return;
  }
  if (typeof node !== 'object') {
    return;
  }
  for (const [key, raw] of Object.entries(node as Record<string, unknown>)) {
    const fieldPath = path === '' ? key : `${path}.${key}`;
    if (key === 'className' || key === 'class') {
      if (typeof raw === 'string') {
        violations.push(...classNameViolations(raw, fieldPath));
      }
      continue;
    }
    if (key === 'style') {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [styleKey, styleVal] of Object.entries(
          raw as Record<string, unknown>,
        )) {
          violations.push(...styleValueViolations(styleKey, styleVal, fieldPath));
        }
        continue;
      }
      if (typeof raw === 'string') {
        // Inline string `style="…"` — same rejection rules as className.
        violations.push(...classNameViolations(raw, fieldPath));
        continue;
      }
    }
    walk(raw, fieldPath, violations);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate brand tokens on an arbitrary UiPart payload. The argument
 * is `unknown` — the validator never trusts its input is well-formed.
 *
 * Returns `{ ok: true }` if no violations, otherwise
 * `{ ok: false, violations: [string, …] }` with one entry per
 * violation.
 */
export function validateBrandTokens(uiPart: unknown): BrandValidationResult {
  const violations: string[] = [];
  walk(uiPart, '', violations);
  if (violations.length === 0) {
    return { ok: true };
  }
  return { ok: false, violations };
}

/**
 * Throwing variant — used inside composers where a brand violation is
 * a programming error, not a content-validation error.
 */
export class BrandTokenViolationError extends Error {
  public override readonly name = 'BrandTokenViolationError';
  public readonly violations: ReadonlyArray<string>;

  public constructor(violations: ReadonlyArray<string>) {
    super(`brand-token validation failed: ${violations.join(' | ')}`);
    this.violations = violations;
  }
}

export function assertBrandTokens(uiPart: unknown): void {
  const result = validateBrandTokens(uiPart);
  if (!result.ok) {
    throw new BrandTokenViolationError(result.violations);
  }
}
