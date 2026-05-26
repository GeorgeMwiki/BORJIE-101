/**
 * Calibration axis — Wave CAPABILITY.
 *
 * Calibration asks: *is the claimed confidence right?*. We translate
 * each outcome into a binary truth value:
 *
 *   confirmed     → 1
 *   disconfirmed  → 0
 *   partial       → 0.5
 *   unknown       → dropped (not measurable)
 *
 * Then we compute:
 *
 *   - Brier score:    mean (p - y)²    over the kept points.
 *   - Expected Calibration Error (ECE) with 10 equally-spaced bins.
 *
 * `calibration_error` reported by this module is the equally-weighted
 * average of Brier and ECE — both already in [0, 1], with 0 = perfect.
 *
 * Pure function; no I/O.
 *
 * Spec: `Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md §5.2`.
 *
 * @module @borjie/capability-catalogue/measurement/calibration
 */

import { CapabilityCatalogueError, type Outcome } from '../types.js';

export interface CalibrationInput {
  readonly outcomes: ReadonlyArray<Outcome>;
  /** Number of ECE bins; default 10. */
  readonly nBins?: number;
}

export interface CalibrationResult {
  readonly error: number;
  readonly brier: number;
  readonly ece: number;
  readonly nObservations: number;
}

const DEFAULT_N_BINS = 10;

function outcomeToY(o: Outcome): number | null {
  switch (o.observedOutcome) {
    case 'confirmed':
      return 1;
    case 'disconfirmed':
      return 0;
    case 'partial':
      return 0.5;
    case 'unknown':
      return null;
    default: {
      const exhaustive: never = o.observedOutcome;
      throw new Error(`unhandled outcome ${String(exhaustive)}`);
    }
  }
}

/**
 * Compute the calibration error over a non-empty outcome stream.
 *
 * @throws CapabilityCatalogueError if no outcomes are scorable
 *         (all `unknown`).
 */
export function computeCalibration(input: CalibrationInput): CalibrationResult {
  if (input.outcomes.length === 0) {
    throw new CapabilityCatalogueError(
      'cannot compute calibration over an empty outcome window',
      'EMPTY_WINDOW',
    );
  }
  const nBins = input.nBins ?? DEFAULT_N_BINS;
  const points: Array<{ p: number; y: number }> = [];
  for (const o of input.outcomes) {
    const y = outcomeToY(o);
    if (y === null) continue;
    points.push({ p: o.claimedConfidence, y });
  }
  if (points.length === 0) {
    throw new CapabilityCatalogueError(
      'no scorable outcomes (all `unknown`)',
      'EMPTY_WINDOW',
    );
  }

  // Brier.
  let brierAcc = 0;
  for (const pt of points) {
    const d = pt.p - pt.y;
    brierAcc += d * d;
  }
  const brier = brierAcc / points.length;

  // ECE — 10-bin equally spaced.
  const binAcc = new Array<number>(nBins).fill(0);
  const binConf = new Array<number>(nBins).fill(0);
  const binCount = new Array<number>(nBins).fill(0);
  for (const pt of points) {
    // Clamp p ∈ [0,1]; map to bin index in [0, nBins-1].
    const clamped = Math.min(1, Math.max(0, pt.p));
    let idx = Math.floor(clamped * nBins);
    if (idx >= nBins) idx = nBins - 1;
    // We've just constructed `idx` to be ∈ [0, nBins-1].
    binAcc[idx] = (binAcc[idx] ?? 0) + pt.y;
    binConf[idx] = (binConf[idx] ?? 0) + clamped;
    binCount[idx] = (binCount[idx] ?? 0) + 1;
  }
  let ece = 0;
  for (let i = 0; i < nBins; i += 1) {
    const c = binCount[i] ?? 0;
    if (c === 0) continue;
    const acc = (binAcc[i] ?? 0) / c;
    const conf = (binConf[i] ?? 0) / c;
    ece += (c / points.length) * Math.abs(conf - acc);
  }

  // Final error = mean of brier + ece; both ∈ [0,1] already.
  const error = (brier + ece) / 2;

  return Object.freeze({
    error,
    brier,
    ece,
    nObservations: points.length,
  });
}
