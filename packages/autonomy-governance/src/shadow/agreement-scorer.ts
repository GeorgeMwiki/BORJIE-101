/**
 * Agreement scorer — pure decision-equivalence over a shadow session.
 *
 * Two dispatch paths:
 *   - `binary`   strict equality (`===`) — yes/no, approve/deny, "FIX-001"
 *   - `numeric`  threshold-bounded: `|ai - human| <= tolerance`
 *
 * The numeric path is forced by reality: rent estimates, late-fee cents,
 * refund amounts, etc. are almost never byte-identical between AI and a
 * human — agreement is "within X". The tolerance is supplied by the
 * caller (via `CutoverCriteria.numericTolerance`) so one cutover run
 * uses one tolerance and the gate is reproducible from (session,
 * criteria) alone.
 *
 * Mixed sessions are supported: each decision dispatches on its own
 * `kind`. Agreement is the count of equivalent pairs over total decisions.
 *
 * Out of scope: per-decision-class confusion matrices, weighted scoring
 * by tier, false-positive vs false-negative breakdowns. Downstream
 * concerns — this file is the substrate for the cutover gate only.
 */

import type { ShadowDecision } from './types.js';

/**
 * Compute the agreement rate for a corpus of shadow decisions.
 *
 * @param decisions  Immutable corpus from `ShadowSession.decisions`.
 * @param numericTolerance  Inclusive tolerance for `kind:'numeric'`
 *                          pairs. `|ai - human| <= tolerance` counts as
 *                          equivalent.
 * @returns  Fraction in [0, 1]. Empty corpus returns 0 (no evidence of
 *           agreement; the cutover gate's sample-size criterion catches
 *           the empty case separately, so this is a safe fall-through).
 */
export function computeAgreementRate(
  decisions: ReadonlyArray<ShadowDecision>,
  numericTolerance: number,
): number {
  if (decisions.length === 0) return 0;

  // Defensive: a NaN / negative tolerance would silently inflate agreement
  // on the numeric path. Treat as a configuration error and refuse to
  // count any numeric pairs (binary still counts).
  const safeTolerance =
    Number.isFinite(numericTolerance) && numericTolerance >= 0
      ? numericTolerance
      : Number.NEGATIVE_INFINITY;

  let agreements = 0;
  for (const d of decisions) {
    if (isEquivalent(d, safeTolerance)) agreements++;
  }
  return agreements / decisions.length;
}

/**
 * Count critical constitution violations in the corpus. Used by the
 * cutover gate as a hard zero-tolerance check (Klarna fingerprint:
 * aggregate agreement does not compensate for a constitution breach).
 */
export function countCriticalViolations(
  decisions: ReadonlyArray<ShadowDecision>,
): number {
  let n = 0;
  for (const d of decisions) {
    if (d.isCriticalViolation) n++;
  }
  return n;
}

/**
 * Decide whether a single shadow-decision pair is equivalent.
 *
 * Exported for completeness; the gate uses `computeAgreementRate`.
 */
export function isEquivalent(
  decision: ShadowDecision,
  numericTolerance: number,
): boolean {
  switch (decision.kind) {
    case 'binary':
      return decision.aiVerdict === decision.humanVerdict;
    case 'numeric':
      return isNumericMatch(
        decision.aiVerdict,
        decision.humanVerdict,
        numericTolerance,
      );
  }
}

function isNumericMatch(
  ai: string | number | boolean,
  human: string | number | boolean,
  tolerance: number,
): boolean {
  if (typeof ai !== 'number' || typeof human !== 'number') return false;
  if (!Number.isFinite(ai) || !Number.isFinite(human)) return false;
  if (!Number.isFinite(tolerance) || tolerance < 0) return false;
  return Math.abs(ai - human) <= tolerance;
}
