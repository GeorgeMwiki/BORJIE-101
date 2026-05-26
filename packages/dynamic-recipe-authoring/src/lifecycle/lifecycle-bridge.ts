/**
 * Lifecycle bridge — Wave 18M.
 *
 * Spec: Docs/DESIGN/DYNAMIC_RECIPE_AUTHORING_SPEC.md §3.
 *
 * Bridges the authored-recipe lifecycle state machine to the
 * catalogue's five-state model from Wave CAPABILITY. The two state
 * sets are intentionally identical (`draft | shadow | live | locked |
 * deprecated`) so a future wave can flatten the two into one shared
 * lifecycle plane without breaking call sites.
 *
 * Pure functions. No I/O. Deterministic.
 */

import {
  ALLOWED_LIFECYCLE_TRANSITIONS,
  type RecipeLifecycle,
} from '../types.js';

export interface LifecycleTransitionAttempt {
  readonly from: RecipeLifecycle;
  readonly to: RecipeLifecycle;
}

export type LifecycleTransitionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Check whether a lifecycle transition is allowed. Pure — does NOT
 * mutate storage. The caller persists the transition via the
 * repository's `transitionLifecycle`.
 */
export function canTransition(
  attempt: LifecycleTransitionAttempt,
): LifecycleTransitionResult {
  if (attempt.from === attempt.to) {
    return {
      ok: false,
      reason: `noop transition: from === to (${attempt.from})`,
    };
  }
  const allowed = ALLOWED_LIFECYCLE_TRANSITIONS[attempt.from];
  if (!allowed.includes(attempt.to)) {
    return {
      ok: false,
      reason: `transition ${attempt.from} → ${attempt.to} is not allowed`,
    };
  }
  return { ok: true };
}

/**
 * Enumerate the legal next transitions from a given state. Useful
 * for the owner UI that renders "what can I promote this to?".
 */
export function nextTransitions(
  from: RecipeLifecycle,
): ReadonlyArray<RecipeLifecycle> {
  return ALLOWED_LIFECYCLE_TRANSITIONS[from];
}

/**
 * `true` when the lifecycle state is terminal — no forward
 * transitions are possible. Today only `deprecated` is terminal.
 */
export function isTerminal(state: RecipeLifecycle): boolean {
  return nextTransitions(state).length === 0;
}

/**
 * Bridge to the capability-catalogue lifecycle string. Today they
 * are identical — this function exists so a downstream consumer can
 * type-narrow on a shared lifecycle string without importing the
 * full catalogue surface.
 */
export function toCatalogueLifecycle(state: RecipeLifecycle): string {
  return state;
}
