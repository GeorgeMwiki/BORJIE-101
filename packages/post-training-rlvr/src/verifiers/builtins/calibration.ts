/**
 * `calibration` verifier — Brier-style. Mr. Mwikila claims a
 * confidence band (`high | medium | low | uncertain`) on every
 * answer. The verifier reads the band, maps it to a midpoint
 * probability, and compares to the *verified outcome* of a sister
 * verifier — typically `tra-schema` or `royalty-math` — to compute
 * the squared error. Reward is `1 - Brier`.
 *
 * Coupling to `@borjie/cognitive-engine` confidence labels is
 * intentional: the runtime already enforces them. We are converting
 * "did Mr. Mwikila's confidence agree with the verified outcome?"
 * into a training signal.
 */

import type {
  RlvrTrace,
  Verifier,
  VerificationResult,
} from '../../types.js';

const BAND_TO_MIDPOINT: Readonly<Record<string, number>> = Object.freeze({
  high: 0.9,
  medium: 0.7,
  low: 0.4,
  uncertain: 0.2,
});

export interface CalibrationInputs {
  readonly band: string;
  readonly verifiedOutcome: 0 | 1;
}

function extract(trace: RlvrTrace): CalibrationInputs | null {
  const meta = trace.metadata as Record<string, unknown>;
  const band = meta['confidence_band'];
  const outcome = meta['verified_outcome'];
  if (typeof band !== 'string') return null;
  if (outcome !== 0 && outcome !== 1) return null;
  if (BAND_TO_MIDPOINT[band] === undefined) return null;
  return Object.freeze({ band, verifiedOutcome: outcome });
}

export function createCalibrationVerifier(): Verifier {
  return {
    name: 'calibration',
    version: '1.0.0',

    applies(trace: RlvrTrace): boolean {
      return extract(trace) !== null;
    },

    async verify(trace: RlvrTrace): Promise<VerificationResult> {
      const input = extract(trace);
      if (input === null) {
        return Object.freeze({
          verifierName: 'calibration',
          verdict: 'skip' as const,
          reward: 0,
          evidence: Object.freeze({ reason: 'no_confidence_band' }),
          confidence: 0,
        });
      }
      const midpoint = BAND_TO_MIDPOINT[input.band] ?? 0.5;
      const brier =
        (midpoint - input.verifiedOutcome) *
        (midpoint - input.verifiedOutcome);
      const reward = Math.max(0, Math.min(1, 1 - brier));
      // Cutoff: high confidence + wrong = `fail`; confident + right = `pass`.
      const aligned =
        (midpoint >= 0.5 && input.verifiedOutcome === 1) ||
        (midpoint < 0.5 && input.verifiedOutcome === 0);
      const verdict = aligned
        ? brier < 0.1
          ? 'pass'
          : 'partial'
        : brier > 0.5
          ? 'fail'
          : 'partial';
      return Object.freeze({
        verifierName: 'calibration',
        verdict,
        reward,
        evidence: Object.freeze({
          band: input.band,
          midpoint,
          verifiedOutcome: input.verifiedOutcome,
          brier,
        }),
        confidence: 1,
      });
    },
  };
}
