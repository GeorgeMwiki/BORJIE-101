/**
 * Pure-function predicate evaluator. Lives outside React so it can be
 * unit-tested directly + reused server-side if a future SSR portal
 * needs to filter sections before hydration.
 */

import type {
  SectionContext,
  VisibilityPredicate,
} from '../contracts/section.js';

/**
 * Evaluate a `VisibilityPredicate` against a `SectionContext`. Returns
 * a boolean — the section is shown iff this returns true.
 *
 * Semantic notes:
 *   - `and` with zero children → true (vacuous truth)
 *   - `or` with zero children → false
 *   - `has-entities` counts default to 0 for absent keys
 *   - `role-allowed` is a logical OR across the supplied roles
 *   - unknown predicate kinds throw — fail loud rather than render a
 *     stale tab. This is a programming error, not user input.
 */
export function evaluatePredicate(
  predicate: VisibilityPredicate,
  context: SectionContext,
): boolean {
  switch (predicate.kind) {
    case 'has-entities': {
      const count = context.entityCounts[predicate.entity_type] ?? 0;
      return count > 0;
    }
    case 'role-allowed': {
      if (predicate.roles.length === 0) return false;
      return predicate.roles.some((role) => context.roles.includes(role));
    }
    case 'feature-flag': {
      return context.featureFlags.includes(predicate.flag);
    }
    case 'and': {
      if (predicate.preds.length === 0) return true;
      return predicate.preds.every((p) => evaluatePredicate(p, context));
    }
    case 'or': {
      if (predicate.preds.length === 0) return false;
      return predicate.preds.some((p) => evaluatePredicate(p, context));
    }
    default: {
      const exhaustive: never = predicate;
      throw new Error(
        `evaluatePredicate: unknown predicate kind: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}
