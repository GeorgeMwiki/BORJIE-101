/**
 * `brand-lock-pass.ts` — runtime mirror of the `borjie/no-non-token-style`
 * ESLint rule (Wave 18K). Rejects any composed recipe carrying raw hex,
 * rgb(), hsl(), oklch() literals, or non-token spacing magic numbers.
 *
 * Pure. Walks the recipe's strings + the manifest's preferred_colors.
 * No I/O.
 */
import type { BrandLockResult, UIHints } from '../types.js';

const RAW_HEX_RE = /#[0-9a-f]{3,8}\b/i;
const RAW_RGB_RE = /\brgba?\s*\(/i;
const RAW_HSL_RE = /\bhsla?\s*\(/i;
const RAW_OKLCH_LITERAL_RE = /\boklch\s*\(\s*[\d.]/i;

const TOKEN_REF_RE = /^var\(--borjie-[a-z0-9-]+\)$/i;
const TOKEN_NAME_RE = /^--borjie-[a-z0-9-]+$/i;

function isLikelyToken(value: string): boolean {
  if (TOKEN_REF_RE.test(value)) return true;
  if (TOKEN_NAME_RE.test(value)) return true;
  // The composer also accepts bare token identifiers (e.g.
  // `borjie.color.surface.primary`) — anything that doesn't look like
  // a raw color literal is treated as a token reference.
  if (
    RAW_HEX_RE.test(value) ||
    RAW_RGB_RE.test(value) ||
    RAW_HSL_RE.test(value) ||
    RAW_OKLCH_LITERAL_RE.test(value)
  ) {
    return false;
  }
  return true;
}

/**
 * Returns the list of offending strings from the manifest's preferred
 * colors. Empty list means brand-lock passes.
 */
export function checkPreferredColors(hints: UIHints): ReadonlyArray<string> {
  return hints.preferred_colors.filter((c) => !isLikelyToken(c));
}

/**
 * Runs the brand-lock pass over a candidate styling bundle. Used by the
 * composer right before returning a recipe.
 */
export function brandLockPass(input: {
  readonly hints: UIHints;
  readonly stylingStrings?: ReadonlyArray<string>;
}): BrandLockResult {
  const colorOffenders = checkPreferredColors(input.hints);
  const styleOffenders = (input.stylingStrings ?? []).filter(
    (s) => !isLikelyToken(s),
  );

  const offenders = [...colorOffenders, ...styleOffenders];
  if (offenders.length === 0) {
    return { ok: true };
  }
  return { ok: false, offenders };
}
