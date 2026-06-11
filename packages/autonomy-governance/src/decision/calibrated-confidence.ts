/**
 * calibrated-confidence — turn a raw model confidence into the
 * conformally-CALIBRATED confidence that `decideAutonomy` requires.
 *
 * The frontier addendum is explicit: calibration MUST precede gating
 * because LLM confidence is systematically overconfident — "I'm 90%
 * sure" has to be statistically true 90% of the time before confidence
 * is allowed to drive delegation. The calibration substrate already
 * exists in `@borjie/conformal-calibration-online` (Adaptive Conformal
 * Inference, Gibbs & Candès 2021) and `@borjie/calibration-monitor`
 * (Brier / ECE).
 *
 * This module is the thin, pure adapter from that substrate into the
 * decision layer's `calibratedConfidence` input. To preserve this
 * package's wire-agnostic, zero-`@borjie`-dependency substrate boundary
 * (the same reason `RiskTier` is duplicated in `types.ts` rather than
 * imported from central-intelligence), the conformal state is accepted
 * STRUCTURALLY via the `ConformalCoverageView` interface — it is the
 * exact public shape of `OnlineConformalState`/`ConformalDiagnostic`, so
 * the output of `@borjie/conformal-calibration-online`'s `diagnostic()`
 * (or a raw state) drops straight in with no coupling.
 *
 * Mechanism:
 *   - The online conformal `alpha` is the calibrated miscoverage rate;
 *     `1 - alpha` is the calibrated coverage the intervals actually
 *     achieve. When the live window has drifted (observed coverage below
 *     target), we discount toward the realised coverage so the
 *     calibrated confidence cannot exceed what the recent track record
 *     supports — never overstate calibration.
 *   - The raw model confidence is then SHRUNK toward that calibrated
 *     coverage ceiling: `calibrated = min(raw, coverageCeiling)`. A
 *     confident-but-uncalibrated model is pulled down to the rate it has
 *     empirically earned; it can never be inflated above it.
 */

/**
 * Structural view of the conformal-calibration state. Matches the public
 * shape of `@borjie/conformal-calibration-online`'s `OnlineConformalState`
 * and `ConformalDiagnostic` so either drops in without a hard dependency.
 */
export interface ConformalCoverageView {
  /** Current calibrated miscoverage rate (alpha). Calibrated coverage = 1 - alpha. */
  readonly alpha: number;
  /** Target coverage (1 - target-alpha), e.g. 0.9. */
  readonly targetCoverage: number;
  /**
   * Realised coverage over the live window, when available. When the
   * window is empty the conformal package reports `targetCoverage`; pass
   * that through (or omit) and no extra discount applies.
   */
  readonly observedCoverage?: number;
}

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * The calibrated coverage ceiling the conformal state currently
 * supports: the lesser of (1 - alpha) and the realised window coverage.
 * Taking the min guarantees we never claim more calibration than the
 * recent track record demonstrates.
 */
export function calibratedCoverageCeiling(
  view: ConformalCoverageView,
): number {
  const fromAlpha = clampUnit(1 - view.alpha);
  if (
    typeof view.observedCoverage === 'number' &&
    Number.isFinite(view.observedCoverage)
  ) {
    return Math.min(fromAlpha, clampUnit(view.observedCoverage));
  }
  return fromAlpha;
}

/**
 * Calibrate a raw model confidence against the conformal coverage view.
 *
 * Returns a value in [0,1] suitable for `DecideAutonomyInput.
 * calibratedConfidence`. The raw confidence is shrunk toward — never
 * inflated above — the calibrated coverage ceiling.
 *
 * @param rawConfidence  the model's stated confidence (clamped to [0,1]).
 * @param view           the conformal-calibration state/diagnostic.
 */
export function calibratedConfidenceFromConformal(
  rawConfidence: number,
  view: ConformalCoverageView,
): number {
  const raw = clampUnit(rawConfidence);
  const ceiling = calibratedCoverageCeiling(view);
  return Math.min(raw, ceiling);
}
