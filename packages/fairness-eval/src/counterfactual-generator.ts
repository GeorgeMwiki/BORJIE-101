/**
 * Counterfactual generator — flip a single protected attribute and
 * leave everything else intact.
 *
 * Returns the cartesian set of counterfactuals (every value in the
 * spec's values list other than the original) — caller can sample if
 * the set is large.
 */

import type {
  CounterfactualPair,
  Profile,
  ProtectedAttributeSpec,
} from './types.js';

/**
 * Generate all counterfactual pairs for `profile` against `attribute`.
 * If the profile lacks the attribute key, returns an empty array.
 */
export function generateCounterfactuals(
  profile: Profile,
  spec: ProtectedAttributeSpec,
): ReadonlyArray<CounterfactualPair> {
  const original = profile[spec.profileKey];
  if (original === undefined || original === null) return [];
  const originalValue = String(original);
  const pairs: CounterfactualPair[] = [];
  for (const value of spec.values) {
    if (value === originalValue) continue;
    const counterfactualProfile: Profile = {
      ...profile,
      [spec.profileKey]: value,
    };
    pairs.push({
      attribute: spec.id,
      profileKey: spec.profileKey,
      originalValue,
      counterfactualValue: value,
      originalProfile: profile,
      counterfactualProfile,
    });
  }
  return pairs;
}
