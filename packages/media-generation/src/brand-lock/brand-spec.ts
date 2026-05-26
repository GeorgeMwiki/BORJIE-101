/**
 * BrandSpec — the source-of-truth for the brand-DNA prompt prefix
 * system.
 *
 * The default Borjie spec mirrors the OKLCH palette anchors used by
 * `packages/design-system/lib/tokens.ts` and the wordmark file in
 * `packages/design-system/src/brand/`. Adding a new tenant brand
 * requires shipping a new BrandSpec with palette anchors, wordmark
 * path, negative-prompt denylist, and consent-token policy.
 *
 * Pure data. No I/O.
 *
 * @module @borjie/media-generation/brand-lock/brand-spec
 */

import type { BrandSpec } from '../types.js';

/**
 * Default Borjie brand spec — the prompt prefix builder uses these
 * values to assemble the mechanical prefix and negative prompt for
 * every generation.
 *
 * Palette anchors mirror the brand signal ramp used in `packages/
 * design-system/lib/tokens.ts`. Wordmark path is exported as a logical
 * reference (`packages/design-system/src/brand/wordmark.svg`); the
 * watermarking module resolves the actual file at runtime.
 */
export const BorjieBrandSpec: BrandSpec = Object.freeze({
  brand: 'borjie',
  photographic_style:
    'documentary, golden-hour, warm but technical, shallow depth of field',
  palette: Object.freeze([
    Object.freeze({
      name: 'signal_primary',
      oklch: 'oklch(0.78 0.16 75)',
      hex: '#f59e0b',
    }),
    Object.freeze({
      name: 'foreground_neutral',
      oklch: 'oklch(0.96 0.02 75)',
      hex: '#f8fafc',
    }),
    Object.freeze({
      name: 'surface_background',
      oklch: 'oklch(0.18 0.02 65)',
      hex: '#0f172a',
    }),
    Object.freeze({
      name: 'signature_gradient_anchor_a',
      oklch: 'oklch(0.34 0.10 250)',
      hex: '#1F3864',
    }),
    Object.freeze({
      name: 'signature_gradient_anchor_b',
      oklch: 'oklch(0.65 0.18 45)',
      hex: '#C45B12',
    }),
  ]),
  typography_rule:
    'font-display sans-serif (Geist or Inter); no other font families on graphics',
  wordmark_policy:
    'when present, top-left, opacity 1, no rotation, no scaling below 64px width',
  negative_prompt_terms: Object.freeze([
    'off-brand color scheme',
    'deepfake of real Borjie personnel without consent',
    'watermark removal',
    'erased watermark',
    'NSFW',
    'nudity',
    'gore',
    'violence',
    'stock-photo cliche',
    'low-resolution',
    'pixelated',
    'cartoonish style',
    'off-brand typography',
    'fake logo',
    'plagiarised composition',
  ]),
  wordmark_svg_path: 'packages/design-system/src/brand/wordmark.svg',
  signature_gradient_direction: '135deg',
  real_person_consent_required: true,
});

/**
 * Read the active brand spec — defaults to Borjie. Future multi-brand
 * support will extend this lookup with a tenant-spec map.
 */
export function getBrandSpec(_tenantId: string): BrandSpec {
  // v1: single brand. The signature is intentionally tenant-scoped so
  // the lookup can grow without callers changing.
  return BorjieBrandSpec;
}
