/**
 * Authority gate — Layer 4 gate #4.
 *
 * "Does the loop have authority to do what it proposes?" The gate
 * compares the proposed mutation's authority tier (0 / 1 / 2) to the
 * granted authority for the loop. Tier-2-Critical proposals always
 * route to double-verify even within an authorised loop.
 *
 * To stay decoupled from `@borjie/mutation-authority`, the gate
 * accepts a `MutationAuthorityPort` whose contract matches the tier
 * + double-verify-trigger semantics in
 * MUTATION_AUTHORITY_SPEC.md §2.
 *
 * Pass criteria (all required):
 *   1. proposed_tier ≤ granted_tier
 *   2. If proposed_tier === 2 AND double_verify_required: gate fails
 *      with a routing reason; the caller is expected to route the
 *      proposal through the double-verify workflow.
 *
 * Spec: Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md §3.4 #4.
 */

import {
  DEFAULT_SIGNAL_WEIGHT,
  QualityGateError,
  type QualityGateResult,
  type QualitySignal,
} from '../types.js';

export type AuthorityTier = 0 | 1 | 2;

export interface MutationAuthorityPort {
  /** Returns true if the proposal needs the double-verify guard. */
  readonly requiresDoubleVerify: (
    proposedTier: AuthorityTier,
    proposalKind: string,
  ) => boolean;
}

export interface AuthorityInput {
  readonly proposedTier: AuthorityTier;
  readonly grantedTier: AuthorityTier;
  /** Free-form classifier (e.g. 'gepg.payment', 'doc.publish'). */
  readonly proposalKind: string;
}

const SIGNAL_NAME = 'authority';

function isTier(n: unknown): n is AuthorityTier {
  return n === 0 || n === 1 || n === 2;
}

function makeSignal(
  score: number,
  evidence: Readonly<Record<string, unknown>>,
): QualitySignal {
  return Object.freeze({
    signal: SIGNAL_NAME,
    score,
    weight: DEFAULT_SIGNAL_WEIGHT,
    evidence,
  });
}

export function authorityGate(
  input: AuthorityInput,
  port: MutationAuthorityPort,
): QualityGateResult {
  if (!input) {
    throw new QualityGateError(
      'authority gate received null input',
      'INVALID_INPUT',
    );
  }
  if (!isTier(input.proposedTier)) {
    throw new QualityGateError(
      `proposedTier must be 0|1|2, got ${String(input.proposedTier)}`,
      'INVALID_INPUT',
    );
  }
  if (!isTier(input.grantedTier)) {
    throw new QualityGateError(
      `grantedTier must be 0|1|2, got ${String(input.grantedTier)}`,
      'INVALID_INPUT',
    );
  }

  // Tier ceiling check.
  if (input.proposedTier > input.grantedTier) {
    return Object.freeze({
      pass: false,
      signal: makeSignal(0.0, {
        proposedTier: input.proposedTier,
        grantedTier: input.grantedTier,
        proposalKind: input.proposalKind,
        reason: 'proposed-tier-exceeds-granted-tier',
      }),
      reason: `fail:tier-${input.proposedTier}-exceeds-granted-${input.grantedTier}`,
    });
  }

  // Tier-2-Critical double-verify routing.
  if (input.proposedTier === 2) {
    const needs = port.requiresDoubleVerify(
      input.proposedTier,
      input.proposalKind,
    );
    if (needs) {
      return Object.freeze({
        pass: false,
        signal: makeSignal(0.0, {
          proposedTier: input.proposedTier,
          grantedTier: input.grantedTier,
          proposalKind: input.proposalKind,
          reason: 'route-to-double-verify',
        }),
        reason: 'fail:tier2-critical-needs-double-verify',
      });
    }
  }

  return Object.freeze({
    pass: true,
    signal: makeSignal(1.0, {
      proposedTier: input.proposedTier,
      grantedTier: input.grantedTier,
      proposalKind: input.proposalKind,
    }),
    reason: `pass:tier-${input.proposedTier}-within-granted-${input.grantedTier}`,
  });
}
