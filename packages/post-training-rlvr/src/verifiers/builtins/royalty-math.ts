/**
 * `royalty-math` verifier — confirm declared royalty amount reconciles
 * to `tonnage * unit_price * rate_pct / 100` within a tenant-configurable
 * tolerance ε (default 0.01 = 1 %).
 *
 * Shaped reward — a declaration that is 0.5 % off receives more reward
 * than one that is 50 % off. Linear distance from ε, clamped to [0, 1].
 */

import type {
  RlvrTrace,
  Verifier,
  VerificationResult,
} from '../../types.js';

export interface RoyaltyMathConfig {
  /** Tolerance for relative error (declared vs expected). Default 0.01. */
  readonly epsilon?: number;
}

interface RoyaltyClaim {
  readonly tonnage: number;
  readonly unitPrice: number;
  readonly ratePct: number;
  readonly declaredAmount: number;
}

function extractClaim(trace: RlvrTrace): RoyaltyClaim | null {
  const meta = trace.metadata as Record<string, unknown>;
  const r = meta['royalty'];
  if (typeof r !== 'object' || r === null) return null;
  const ro = r as Record<string, unknown>;
  const tonnage = ro['tonnage'];
  const unitPrice = ro['unit_price'];
  const ratePct = ro['rate_pct'];
  const declared = ro['declared_amount'];
  if (
    typeof tonnage !== 'number' ||
    typeof unitPrice !== 'number' ||
    typeof ratePct !== 'number' ||
    typeof declared !== 'number' ||
    tonnage <= 0 ||
    unitPrice < 0 ||
    ratePct < 0
  ) {
    return null;
  }
  return Object.freeze({
    tonnage,
    unitPrice,
    ratePct,
    declaredAmount: declared,
  });
}

export function createRoyaltyMathVerifier(
  config: RoyaltyMathConfig = {},
): Verifier {
  const epsilon = config.epsilon ?? 0.01;

  return {
    name: 'royalty-math',
    version: '1.0.0',

    applies(trace: RlvrTrace): boolean {
      return extractClaim(trace) !== null;
    },

    async verify(trace: RlvrTrace): Promise<VerificationResult> {
      const claim = extractClaim(trace);
      if (claim === null) {
        return Object.freeze({
          verifierName: 'royalty-math',
          verdict: 'skip' as const,
          reward: 0,
          evidence: Object.freeze({ reason: 'no_royalty_claim' }),
          confidence: 0,
        });
      }

      const expected =
        claim.tonnage * claim.unitPrice * (claim.ratePct / 100);
      const absoluteError = Math.abs(claim.declaredAmount - expected);
      const relativeError =
        expected === 0 ? absoluteError : absoluteError / expected;

      if (relativeError <= epsilon) {
        return Object.freeze({
          verifierName: 'royalty-math',
          verdict: 'pass' as const,
          reward: 1,
          evidence: Object.freeze({
            expected,
            declared: claim.declaredAmount,
            relativeError,
          }),
          confidence: 1,
        });
      }

      // Linear shaped reward — relativeError of `epsilon` → 1.0;
      // relativeError of 1.0 (100 % off) → 0.
      const reward = Math.max(
        0,
        Math.min(1, 1 - (relativeError - epsilon) / (1 - epsilon)),
      );
      const verdict = reward > 0 ? 'partial' : 'fail';
      return Object.freeze({
        verifierName: 'royalty-math',
        verdict,
        reward,
        evidence: Object.freeze({
          expected,
          declared: claim.declaredAmount,
          relativeError,
          epsilon,
        }),
        confidence: 1,
      });
    },
  };
}
