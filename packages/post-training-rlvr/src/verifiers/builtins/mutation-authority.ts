/**
 * `mutation-authority` verifier — confirm the proposed authority tier
 * (T0/T1/T2) is at least as restrictive as the subject's required tier.
 *
 *   T0 → any actor can execute.
 *   T1 → requires `owner` approval (or programmatic owner-equivalent).
 *   T2 → requires `owner` + `second_authoriser`; T2-Critical also
 *        requires `founder` approval.
 *
 * A proposal asserted as T0 when the subject requires T2-Critical
 * trips an immediate `fail` regardless of any other verifier passing
 * — the §6.3 constitutional rule from the RLVR spec.
 */

import type {
  RlvrTrace,
  Verifier,
  VerificationResult,
} from '../../types.js';

const TIER_RANK: Readonly<Record<string, number>> = Object.freeze({
  t0: 0,
  t1: 1,
  t2: 2,
  t2_critical: 3,
});

interface AuthorityClaim {
  readonly proposedTier: string;
  readonly requiredTier: string;
  readonly approvers: ReadonlyArray<string>;
}

function extract(trace: RlvrTrace): AuthorityClaim | null {
  const meta = trace.metadata as Record<string, unknown>;
  const m = meta['mutation'];
  if (typeof m !== 'object' || m === null) return null;
  const mo = m as Record<string, unknown>;
  const proposed = mo['proposed_tier'];
  const required = mo['required_tier'];
  const approvers = mo['approvers'];
  if (
    typeof proposed !== 'string' ||
    typeof required !== 'string' ||
    !Array.isArray(approvers)
  ) {
    return null;
  }
  const approversTyped = approvers.filter(
    (a): a is string => typeof a === 'string',
  );
  return Object.freeze({
    proposedTier: proposed,
    requiredTier: required,
    approvers: Object.freeze(approversTyped),
  });
}

function approverGateSatisfied(tier: string, approvers: ReadonlyArray<string>): boolean {
  switch (tier) {
    case 't0':
      return true;
    case 't1':
      return approvers.includes('owner');
    case 't2':
      return (
        approvers.includes('owner') &&
        approvers.includes('second_authoriser')
      );
    case 't2_critical':
      return (
        approvers.includes('owner') &&
        approvers.includes('second_authoriser') &&
        approvers.includes('founder')
      );
    default:
      return false;
  }
}

export function createMutationAuthorityVerifier(): Verifier {
  return {
    name: 'mutation-authority',
    version: '1.0.0',

    applies(trace: RlvrTrace): boolean {
      return extract(trace) !== null;
    },

    async verify(trace: RlvrTrace): Promise<VerificationResult> {
      const claim = extract(trace);
      if (claim === null) {
        return Object.freeze({
          verifierName: 'mutation-authority',
          verdict: 'skip' as const,
          reward: 0,
          evidence: Object.freeze({ reason: 'no_mutation_claim' }),
          confidence: 0,
        });
      }

      const proposedRank = TIER_RANK[claim.proposedTier];
      const requiredRank = TIER_RANK[claim.requiredTier];
      if (proposedRank === undefined || requiredRank === undefined) {
        return Object.freeze({
          verifierName: 'mutation-authority',
          verdict: 'fail' as const,
          reward: 0,
          evidence: Object.freeze({
            reason: 'unknown_tier',
            proposed: claim.proposedTier,
            required: claim.requiredTier,
          }),
          confidence: 1,
        });
      }

      // Asserted tier must be at least as high as required.
      if (proposedRank < requiredRank) {
        return Object.freeze({
          verifierName: 'mutation-authority',
          verdict: 'fail' as const,
          reward: 0,
          evidence: Object.freeze({
            reason: 'tier_under_requirement',
            proposed: claim.proposedTier,
            required: claim.requiredTier,
          }),
          confidence: 1,
        });
      }

      // And the approver gate must be satisfied for the *required* tier.
      const gateOk = approverGateSatisfied(
        claim.requiredTier,
        claim.approvers,
      );
      if (!gateOk) {
        return Object.freeze({
          verifierName: 'mutation-authority',
          verdict: 'fail' as const,
          reward: 0,
          evidence: Object.freeze({
            reason: 'approver_gate_unsatisfied',
            required: claim.requiredTier,
            approvers: claim.approvers,
          }),
          confidence: 1,
        });
      }

      return Object.freeze({
        verifierName: 'mutation-authority',
        verdict: 'pass' as const,
        reward: 1,
        evidence: Object.freeze({
          proposed: claim.proposedTier,
          required: claim.requiredTier,
          approvers: claim.approvers,
        }),
        confidence: 1,
      });
    },
  };
}
