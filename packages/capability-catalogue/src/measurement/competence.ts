/**
 * Competence axis — Wave CAPABILITY.
 *
 * Competence asks: *does the capability succeed?*. Operationally
 *
 *   competence_rate = successes / invocations
 *
 * where `success === true` iff:
 *   - the invocation returned without throwing (Invocation.success), AND
 *   - the resolved outcome did NOT stamp `disconfirmed`.
 *
 * This is the SRE-style error-rate inversion adapted for AI
 * capabilities. Pure function; no I/O.
 *
 * Spec: `Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md §5.1`.
 *
 * @module @borjie/capability-catalogue/measurement/competence
 */

import { CapabilityCatalogueError, type Invocation, type Outcome } from '../types.js';

export interface CompetenceInput {
  readonly invocations: ReadonlyArray<Invocation>;
  /** Optional outcome stream — when supplied, `disconfirmed` flips success → false. */
  readonly outcomesByInvocationId?: ReadonlyMap<string, Outcome>;
}

export interface CompetenceResult {
  readonly rate: number;
  readonly nObservations: number;
  readonly successes: number;
}

/**
 * Compute competence rate over a non-empty invocation set.
 *
 * @throws CapabilityCatalogueError when `invocations` is empty.
 */
export function computeCompetence(input: CompetenceInput): CompetenceResult {
  if (input.invocations.length === 0) {
    throw new CapabilityCatalogueError(
      'cannot compute competence over an empty invocation window',
      'EMPTY_WINDOW',
    );
  }
  let successes = 0;
  for (const inv of input.invocations) {
    if (!inv.success) continue;
    const outcome = input.outcomesByInvocationId?.get(inv.id);
    if (outcome && outcome.observedOutcome === 'disconfirmed') continue;
    successes += 1;
  }
  return Object.freeze({
    rate: successes / input.invocations.length,
    nObservations: input.invocations.length,
    successes,
  });
}
