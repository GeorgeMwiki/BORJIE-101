/**
 * Conformal confidence gate — turns the online-ACI calibrated alpha into a LIVE
 * change in the confidence a chat turn actually emits to the owner.
 *
 * WHY THIS EXISTS (the honest seam):
 *   The live chat path (`routes/mining/chat-orchestrator.ts`) emits
 *   `brainOut.confidence` — a float the Master Brain LLM produces and that the
 *   `message_chunk` SSE frame ships to the cockpit. There is NO native
 *   threshold-classification mechanism in that live path (the central-intelligence
 *   kernel `scoreConfidence` / `uncertainty-policy` and the ai-copilot
 *   prediction-engine `scoreToConfidenceLevel` both exist but have ZERO live
 *   consumers — verified). So the calibrated alpha cannot be injected into a
 *   pre-existing computation; instead we re-grade the emitted float against
 *   alpha-shifted confidence tiers and return an adjusted confidence.
 *
 * THE SHIFT (identical math to the proven `@borjie/cognitive-engine`
 * `confidence-calibrator.ts` `conformalAdjustedThresholds`, 13/13):
 *   The interval's target coverage is `1 - alpha`. Compared to the package
 *   baseline alpha (`DEFAULT_INITIAL_ALPHA` = the value a fresh ACI state holds):
 *     - alpha ABOVE baseline → the brain was OVER-covering (too cautious) → RELAX
 *       (lower) the tier thresholds so a well-grounded answer clears a higher tier.
 *     - alpha BELOW baseline → the brain was UNDER-covering (too confident) →
 *       TIGHTEN (raise) the thresholds so it must be more grounded to claim a tier.
 *   `shift = clamp(gain * (alpha - baseline), ±cap)`, thresholds become
 *   `base - shift`, clamped to [0,1] and re-ordered (high ≥ medium ≥ low). The
 *   constants mirror cognitive-engine so the live behaviour matches the proven
 *   unit tests exactly — but we re-implement the ~10-line pure function here so
 *   api-gateway gains NO new cross-package dependency (cognitive-engine is not a
 *   gateway dep; `conformalAdjustedThresholds` is not on its public surface).
 *
 * WHAT CHANGES ON THE WIRE:
 *   The emitted float is mapped to a tier (high/medium/low/floor) using the
 *   alpha-shifted thresholds, then SNAPPED to that tier's representative
 *   confidence. So when the loop has learned (alpha drifted from baseline) the
 *   SAME LLM float yields a DIFFERENT `message_chunk.confidence` — demonstrably
 *   the conformal loop changing the brain's live confidence output, not metadata.
 *   When alpha === baseline (cold start) the output equals the input tier's
 *   snap — i.e. conformal-off behaviour is stable and never fabricated.
 *
 * Purity: this module is a pure function + constants. No IO, no `console.log`.
 * The alpha is supplied by the caller (fetched from the conformal loop's
 * `getCalibratedAlpha`, which is RLS/tenant-scoped at its own seam).
 */

/**
 * Baseline alpha a fresh ACI state initialises to
 * (`DEFAULT_INITIAL_ALPHA` in `@borjie/conformal-calibration-online`). Mirrored
 * locally — the value is a stable package contract and importing it here would
 * pull no extra runtime, but the constant keeps this module a pure leaf. The
 * live calibrated alpha is compared against THIS to decide over/under-coverage.
 */
export const CONFORMAL_BASELINE_ALPHA = 0.1;

/** Each unit of (alpha − baseline) moves a threshold by this much pre-clamp. */
export const CONFORMAL_THRESHOLD_GAIN = 1.0;

/** Hard cap on how far alpha may move any threshold (tiers can never collapse). */
export const CONFORMAL_MAX_THRESHOLD_SHIFT = 0.15;

export interface ConfidenceTierThresholds {
  readonly high: number;
  readonly medium: number;
  readonly low: number;
}

/**
 * Default tier cut points for an emitted [0,1] confidence float. These mirror
 * the cognitive-engine `DEFAULT_THRESHOLDS` so a tier label means the same thing
 * across the codebase.
 */
export const DEFAULT_CONFIDENCE_TIERS: ConfidenceTierThresholds = Object.freeze({
  high: 0.75,
  medium: 0.5,
  low: 0.3,
});

export type ConfidenceTier = 'high' | 'medium' | 'low' | 'floor';

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Derive alpha-shifted tier thresholds. Pure. When `alpha` is undefined / NaN
 * the base thresholds are returned untouched (conformal-off path). Identical
 * formula + clamping + re-ordering to cognitive-engine's
 * `conformalAdjustedThresholds`.
 */
export function conformalAdjustedTiers(
  base: ConfidenceTierThresholds,
  alpha: number | undefined,
): ConfidenceTierThresholds {
  if (alpha === undefined || Number.isNaN(alpha)) return base;
  const a = clamp01(alpha);
  const rawShift = CONFORMAL_THRESHOLD_GAIN * (a - CONFORMAL_BASELINE_ALPHA);
  const shift = Math.max(
    -CONFORMAL_MAX_THRESHOLD_SHIFT,
    Math.min(CONFORMAL_MAX_THRESHOLD_SHIFT, rawShift),
  );
  const high = clamp01(base.high - shift);
  const medium = clamp01(base.medium - shift);
  const low = clamp01(base.low - shift);
  // Preserve high ≥ medium ≥ low after clamping.
  const orderedMedium = Math.min(medium, high);
  const orderedLow = Math.min(low, orderedMedium);
  return { high, medium: orderedMedium, low: orderedLow };
}

/** Classify an emitted confidence float into a tier using shifted thresholds. */
export function classifyConfidenceTier(
  score: number,
  tiers: ConfidenceTierThresholds,
): ConfidenceTier {
  const s = clamp01(score);
  if (s >= tiers.high) return 'high';
  if (s >= tiers.medium) return 'medium';
  if (s >= tiers.low) return 'low';
  return 'floor';
}

export interface ConformalConfidenceResult {
  /** The confidence to ship on the wire AFTER the conformal adjustment. */
  readonly confidence: number;
  /** The tier the (shifted) thresholds placed the answer in. */
  readonly tier: ConfidenceTier;
  /** The thresholds actually used (base when alpha was absent / baseline). */
  readonly effectiveThresholds: ConfidenceTierThresholds;
  /** Echo of the alpha applied (undefined when none was supplied). */
  readonly calibratedAlpha?: number;
  /** The raw emitted confidence before adjustment (audit trail). */
  readonly rawConfidence: number;
}

/**
 * Map a tier back to a representative confidence. Snapping to the tier floor
 * (rather than an arbitrary midpoint) keeps the output monotonic in the input
 * and means a tier downgrade is always visible as a strictly lower number.
 * `floor` keeps the raw value (already below the lowest tier — nothing to snap
 * up to) clamped to the band below `low` so it can never read as `low`.
 */
function tierToConfidence(
  tier: ConfidenceTier,
  raw: number,
  tiers: ConfidenceTierThresholds,
): number {
  switch (tier) {
    case 'high':
      return tiers.high;
    case 'medium':
      return tiers.medium;
    case 'low':
      return tiers.low;
    case 'floor':
      // Below the lowest tier: report the raw score but never let it reach the
      // (possibly lowered) `low` cut, so the tier label and number agree.
      return Math.min(clamp01(raw), Math.max(0, tiers.low - 1e-6));
  }
}

/**
 * Apply the live calibrated alpha to an emitted confidence float. This is the
 * load-bearing call the chat orchestrator makes right before it ships the
 * `message_chunk` — it is where the conformal loop changes the brain's live
 * confidence OUTPUT.
 *
 * When `alpha` is undefined (loop unavailable) or equals the baseline (cold
 * start) the thresholds are unshifted and the result is the deterministic tier
 * snap of the raw float — i.e. identical, stable behaviour with the loop off.
 */
export function applyConformalConfidence(
  rawConfidence: number,
  alpha: number | undefined,
  base: ConfidenceTierThresholds = DEFAULT_CONFIDENCE_TIERS,
): ConformalConfidenceResult {
  const raw = clamp01(rawConfidence);
  const effectiveThresholds = conformalAdjustedTiers(base, alpha);
  const tier = classifyConfidenceTier(raw, effectiveThresholds);
  const confidence = tierToConfidence(tier, raw, effectiveThresholds);
  return {
    confidence,
    tier,
    effectiveThresholds,
    rawConfidence: raw,
    ...(alpha !== undefined && !Number.isNaN(alpha)
      ? { calibratedAlpha: alpha }
      : {}),
  };
}
