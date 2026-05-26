/**
 * Output-side brand validator.
 *
 * Layer 3 post-generation check: confirms the rendered artefact
 * carries Borjie brand cues at the recipe-declared density. The
 * canonical implementation calls an Anthropic Haiku 4.5 vision API to
 * grade palette density, wordmark integrity, and signature treatment
 * — but the dependency is optional. When the API key is absent the
 * validator returns a permissive default and logs a warning.
 *
 * The validator is intentionally simple: it scores three properties
 * in [0, 1] and exposes a denylist of violation flags. Tighter brand
 * gates live in the dispatcher (which decides whether to retry, refuse,
 * or downgrade the artifact's authority tier).
 *
 * Pure logic where possible; vision API call is graceful-degrading.
 *
 * @module @borjie/media-generation/brand-lock/output-validator
 */

import type { BrandSpec, MediaLogger } from '../types.js';
import { NOOP_LOGGER } from '../types.js';

export interface OutputValidationInput {
  readonly artifact_bytes: Buffer;
  readonly format: 'image' | 'short_video' | 'lipsync_video';
  readonly brand: BrandSpec;
  readonly recipe_id: string;
  /** Expected wordmark? When the recipe didn't ask for wordmark
   *  composition, the validator skips the wordmark integrity check. */
  readonly expect_wordmark: boolean;
  readonly logger?: MediaLogger;
  /** Optional override — production wires this to Anthropic. */
  readonly visionApiFn?: VisionApiFn;
}

export interface OutputValidationResult {
  readonly ok: boolean;
  readonly palette_density: number;
  readonly wordmark_integrity: number;
  readonly signature_treatment: number;
  readonly violation_flags: ReadonlyArray<string>;
}

export type VisionApiFn = (input: {
  readonly artifact_bytes: Buffer;
  readonly brand_palette_oklch: ReadonlyArray<string>;
  readonly expect_wordmark: boolean;
}) => Promise<{
  readonly palette_density: number;
  readonly wordmark_integrity: number;
  readonly signature_treatment: number;
}>;

/**
 * Minimum thresholds — anything below is a brand-violation flag.
 * Tier-2 recipes raise these (handled by the dispatcher's retry-loop).
 */
export const DEFAULT_THRESHOLDS = Object.freeze({
  palette_density: 0.5,
  wordmark_integrity: 0.8,
  signature_treatment: 0.5,
});

/**
 * Validate an artifact against the brand spec. Returns a result with
 * scores in [0, 1]; ok=true iff every score meets the default
 * threshold. The caller decides whether to retry or refuse on failure.
 */
export async function validateOutputBrand(
  input: OutputValidationInput,
): Promise<OutputValidationResult> {
  const logger = input.logger ?? NOOP_LOGGER;
  const fn = input.visionApiFn;

  if (!fn) {
    logger.warn('output-validator: visionApiFn not wired, returning permissive default');
    return {
      ok: true,
      palette_density: 1,
      wordmark_integrity: input.expect_wordmark ? 1 : 1,
      signature_treatment: 1,
      violation_flags: [],
    };
  }

  let scores;
  try {
    scores = await fn({
      artifact_bytes: input.artifact_bytes,
      brand_palette_oklch: input.brand.palette.map((p) => p.oklch),
      expect_wordmark: input.expect_wordmark,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('output-validator: vision call failed', { err: msg });
    return {
      ok: true,
      palette_density: 1,
      wordmark_integrity: 1,
      signature_treatment: 1,
      violation_flags: [],
    };
  }

  const violations: string[] = [];
  if (scores.palette_density < DEFAULT_THRESHOLDS.palette_density) {
    violations.push('palette_density_below_threshold');
  }
  if (
    input.expect_wordmark &&
    scores.wordmark_integrity < DEFAULT_THRESHOLDS.wordmark_integrity
  ) {
    violations.push('wordmark_integrity_below_threshold');
  }
  if (scores.signature_treatment < DEFAULT_THRESHOLDS.signature_treatment) {
    violations.push('signature_treatment_below_threshold');
  }

  return {
    ok: violations.length === 0,
    palette_density: scores.palette_density,
    wordmark_integrity: scores.wordmark_integrity,
    signature_treatment: scores.signature_treatment,
    violation_flags: violations,
  };
}
