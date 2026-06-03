/**
 * Per-field confidence calibration via Platt scaling (LP-26).
 *
 * Raw confidence from upstream signals (vote agreement, schema validity,
 * logprobs) is biased — the extractor over- or under-states certainty by
 * field type. Platt scaling fits a logistic curve `sigmoid(a*x + b)` to
 * historical (raw, correct) pairs and remaps future raw scores.
 *
 * This module is PURE — no filesystem, no import-time I/O. The host loads a
 * fitted {@link CalibrationTable} from its own config and passes it in; in
 * the absence of one, the built-in mining-tuned default table is used.
 *
 * @module @borjie/document-reconciliation/calibration
 */

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** y = sigmoid(a*x + b). */
export interface PlattParams {
  readonly a: number;
  readonly b: number;
}

/** Calibration table keyed by field-type identifier (or coarse bucket). */
export type CalibrationTable = Readonly<Record<string, PlattParams>>;

/** Default Platt params when no field-specific curve exists. */
export const DEFAULT_PLATT: PlattParams = { a: 4, b: -2 };

/**
 * Built-in v0 calibration, mining-tuned. Structured identifiers (NIDA, TIN,
 * licence ref, dates) get a precision uplift; free-text gets a downward pull
 * so weak shots escalate to human review more readily.
 */
export const DEFAULT_CALIBRATION_TABLE: CalibrationTable = Object.freeze({
  default: DEFAULT_PLATT,
  national_id_number: { a: 5, b: -2.3 },
  nida_number: { a: 5, b: -2.3 },
  tin_number: { a: 5, b: -2.3 },
  licence_ref: { a: 5, b: -2.3 },
  mining_licence_number: { a: 5, b: -2.3 },
  date: { a: 5, b: -2.3 },
  amount: { a: 4.5, b: -2.1 },
  royalty_amount: { a: 4.5, b: -2.1 },
  free_text: { a: 3.5, b: -1.9 },
  business_name: { a: 3.5, b: -1.9 },
});

// ----------------------------------------------------------------------------
// Pure math
// ----------------------------------------------------------------------------

export function sigmoid(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Apply a Platt curve to one raw score (clamped to [0,1] in + out). */
export function applyPlatt(rawScore: number, params: PlattParams): number {
  const clamped = clamp01(rawScore);
  return clamp01(sigmoid(params.a * clamped + params.b));
}

/**
 * Calibrate a raw confidence for a field type. Never throws — an unknown
 * field type uses the default curve.
 */
export function calibrate(
  rawScore: number,
  fieldType: string,
  table: CalibrationTable = DEFAULT_CALIBRATION_TABLE,
): number {
  const params = table[fieldType] ?? table.default ?? DEFAULT_PLATT;
  return applyPlatt(rawScore, params);
}

// ----------------------------------------------------------------------------
// Temperature-scaled Platt fit (held-out fitting)
// ----------------------------------------------------------------------------

export interface CalibrationSample {
  readonly rawScore: number;
  readonly correct: boolean;
}

/**
 * Fit Platt scaling with a temperature term to a held-out set. Coarse grid
 * search then a fine gradient-descent refinement. Returns the fitted
 * params, the calibrated probabilities, and the held-out ECE (lower is
 * better; target <= 0.03).
 */
export function temperatureScaledPlatt(samples: readonly CalibrationSample[]): {
  readonly params: { readonly a: number; readonly b: number; readonly t: number };
  readonly calibrated: readonly number[];
  readonly ece: number;
} {
  if (samples.length === 0) {
    return { params: { a: 1, b: 0, t: 1 }, calibrated: [], ece: 0 };
  }

  let best = { a: 4, b: -2, t: 1 };
  let bestNll = nll(samples, best);
  const aGrid = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8];
  const bGrid = [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
  const tGrid = [0.5, 0.75, 1.0, 1.5, 2.0];
  for (const a of aGrid) {
    for (const b of bGrid) {
      for (const tt of tGrid) {
        const score = nll(samples, { a, b, t: tt });
        if (score < bestNll) {
          bestNll = score;
          best = { a, b, t: tt };
        }
      }
    }
  }

  const lr = 0.05;
  for (let step = 0; step < 50; step += 1) {
    const grad = { a: 0, b: 0, t: 0 };
    for (const s of samples) {
      const x = clamp01(s.rawScore);
      const denom = Math.max(0.1, best.t);
      const p = sigmoid((best.a * x + best.b) / denom);
      const dz = p - (s.correct ? 1 : 0);
      grad.a += dz * x;
      grad.b += dz;
      grad.t += dz * (-(best.a * x + best.b) / Math.max(0.1, best.t * best.t));
    }
    const n = samples.length;
    best = {
      a: best.a - (lr * grad.a) / n,
      b: best.b - (lr * grad.b) / n,
      t: Math.max(0.1, best.t - (lr * grad.t) / n),
    };
  }

  const calibrated = samples.map((s) => clamp01(sigmoid((best.a * clamp01(s.rawScore) + best.b) / best.t)));
  const ece = expectedCalibrationError(calibrated, samples.map((s) => s.correct));
  return { params: best, calibrated, ece };
}

function nll(samples: readonly CalibrationSample[], p: { a: number; b: number; t: number }): number {
  let total = 0;
  const eps = 1e-9;
  for (const s of samples) {
    const x = clamp01(s.rawScore);
    const prob = sigmoid((p.a * x + p.b) / Math.max(0.1, p.t));
    total -= s.correct ? Math.log(prob + eps) : Math.log(1 - prob + eps);
  }
  return total / Math.max(1, samples.length);
}

/** Expected Calibration Error over `bins` equal-width bins on [0,1]. */
export function expectedCalibrationError(
  probs: readonly number[],
  outcomes: readonly boolean[],
  bins = 10,
): number {
  if (probs.length !== outcomes.length || probs.length === 0) return 0;
  const binConf = new Array(bins).fill(0);
  const binAcc = new Array(bins).fill(0);
  const binCount = new Array(bins).fill(0);
  for (let i = 0; i < probs.length; i += 1) {
    const p = clamp01(probs[i] ?? 0);
    const idx = Math.min(bins - 1, Math.floor(p * bins));
    binConf[idx] += p;
    binAcc[idx] += outcomes[i] ? 1 : 0;
    binCount[idx] += 1;
  }
  let ece = 0;
  const n = probs.length;
  for (let i = 0; i < bins; i += 1) {
    if (binCount[i] === 0) continue;
    ece += (binCount[i] / n) * Math.abs(binConf[i] / binCount[i] - binAcc[i] / binCount[i]);
  }
  return ece;
}
