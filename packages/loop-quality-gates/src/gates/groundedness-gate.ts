/**
 * Groundedness gate — Layer 4 gate #1.
 *
 * "Cite or stay silent." Every factual claim must carry a non-empty
 * list of citations resolving to a real evidence item. The contract
 * here is intentionally minimal — the heavy citation-resolution lives
 * in `@borjie/cognitive-engine`'s cite-validator. This gate is a thin
 * pre-check that callers can run against the artifact-level shape
 * before delegating to the deeper validator.
 *
 * Pass criteria (all required):
 *   1. At least one claim is present (or the output explicitly opted
 *      into "no factual claims").
 *   2. Every claim has at least one citation_id.
 *   3. The provided citation index resolves every claim's citation_id
 *      to a non-empty record.
 *
 * Spec: Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md §3.4 #1.
 */

import {
  DEFAULT_SIGNAL_WEIGHT,
  QualityGateError,
  type QualityGateResult,
  type QualitySignal,
} from '../types.js';

export interface GroundednessClaim {
  readonly id: string;
  readonly text: string;
  readonly citationIds: ReadonlyArray<string>;
}

export interface GroundednessInput {
  readonly claims: ReadonlyArray<GroundednessClaim>;
  /** Map of citation id → minimal record (URL, title, recorded_at, …). */
  readonly citationIndex: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** Override for outputs that explicitly have no factual claims. */
  readonly noFactualClaims?: boolean;
}

const SIGNAL_NAME = 'groundedness';

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

export function groundednessGate(input: GroundednessInput): QualityGateResult {
  if (!input) {
    throw new QualityGateError(
      'groundedness gate received null input',
      'INVALID_INPUT',
    );
  }

  // No factual claims — gate passes by explicit opt-out.
  if (input.noFactualClaims === true) {
    return Object.freeze({
      pass: true,
      signal: makeSignal(1.0, { noFactualClaims: true }),
      reason: 'pass:no-factual-claims',
    });
  }

  if (input.claims.length === 0) {
    return Object.freeze({
      pass: false,
      signal: makeSignal(0.0, { reason: 'no-claims-and-no-opt-out' }),
      reason: 'fail:no-claims-and-no-opt-out',
    });
  }

  const failingClaimIds: string[] = [];
  const unresolvedCitations: string[] = [];

  for (const claim of input.claims) {
    if (claim.citationIds.length === 0) {
      failingClaimIds.push(claim.id);
      continue;
    }
    for (const citeId of claim.citationIds) {
      const record = input.citationIndex.get(citeId);
      if (!record || Object.keys(record).length === 0) {
        unresolvedCitations.push(citeId);
      }
    }
  }

  if (failingClaimIds.length === 0 && unresolvedCitations.length === 0) {
    return Object.freeze({
      pass: true,
      signal: makeSignal(1.0, {
        claimsTotal: input.claims.length,
        claimsCovered: input.claims.length,
      }),
      reason: 'pass:all-claims-grounded',
    });
  }

  // Partial-fail score = ratio of fully-grounded claims.
  const groundedClaims = input.claims.length - failingClaimIds.length;
  const score = input.claims.length === 0 ? 0 : groundedClaims / input.claims.length;

  return Object.freeze({
    pass: false,
    signal: makeSignal(score, {
      failingClaimIds: Object.freeze([...failingClaimIds]),
      unresolvedCitations: Object.freeze([...unresolvedCitations]),
      claimsTotal: input.claims.length,
    }),
    reason: `fail:${failingClaimIds.length}-uncited-claims:${unresolvedCitations.length}-unresolved-citations`,
  });
}
