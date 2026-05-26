/**
 * Utility axis — Wave CAPABILITY.
 *
 * Utility asks: *did users follow through with the output?*.
 *
 *   utility_rate = (accepted + 0.5 · modified)
 *                  / (accepted + modified + rejected + ignored)
 *
 * Pure function; no I/O.
 *
 * Spec: `Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md §5.3`.
 *
 * @module @borjie/capability-catalogue/measurement/utility
 */

import { CapabilityCatalogueError, type Outcome } from '../types.js';

export interface UtilityInput {
  readonly outcomes: ReadonlyArray<Outcome>;
}

export interface UtilityResult {
  readonly rate: number;
  readonly nObservations: number;
  readonly accepted: number;
  readonly modified: number;
  readonly rejected: number;
  readonly ignored: number;
}

const MODIFIED_WEIGHT = 0.5;

/**
 * Compute the utility rate over a non-empty outcome window.
 *
 * @throws CapabilityCatalogueError when `outcomes` is empty.
 */
export function computeUtility(input: UtilityInput): UtilityResult {
  if (input.outcomes.length === 0) {
    throw new CapabilityCatalogueError(
      'cannot compute utility over an empty outcome window',
      'EMPTY_WINDOW',
    );
  }
  let accepted = 0;
  let modified = 0;
  let rejected = 0;
  let ignored = 0;
  for (const o of input.outcomes) {
    switch (o.userFollowthrough) {
      case 'accepted':
        accepted += 1;
        break;
      case 'modified':
        modified += 1;
        break;
      case 'rejected':
        rejected += 1;
        break;
      case 'ignored':
        ignored += 1;
        break;
      default: {
        const exhaustive: never = o.userFollowthrough;
        throw new Error(`unhandled followthrough ${String(exhaustive)}`);
      }
    }
  }
  const total = accepted + modified + rejected + ignored;
  const numerator = accepted + MODIFIED_WEIGHT * modified;
  return Object.freeze({
    rate: numerator / total,
    nObservations: total,
    accepted,
    modified,
    rejected,
    ignored,
  });
}
