/**
 * Feature detector (Wave 18BB-gap, research-grade stub).
 *
 * Runs a feature dictionary forward over a single activation vector
 * and returns the set of features that fired above their threshold
 * (after tenant-specific overrides via `threshold-policy`).
 *
 * Math is the standard SAE forward operation:
 *
 *   activation_strength_i = ReLU( ⟨direction_i, activation⟩ + bias_i )
 *
 * If `activation_strength_i >= threshold_i` we record a firing.
 *
 * Phase 2 will replace the placeholder dictionary returned by
 * `getPlaceholderDictionary` with trained vectors. The runtime
 * contract here is identical for both — only the weights change.
 *
 * This module is pure (no I/O, no audit). Composition with the
 * audit chain + repository lives in `index.ts` via the
 * `createProbeRunner` factory.
 */

import {
  SAE_FEATURE_CATEGORIES,
  SaeProbeError,
  type ActivationVector,
  type SaeFeatureCategory,
  type SaeFeatureDictionaryEntry,
  type ThresholdOverride,
} from '../types.js';
import { resolveThreshold } from './threshold-policy.js';

/**
 * A single fired feature with its computed activation strength + the
 * effective threshold used at firing time (which may be a tenant
 * override).
 */
export interface DetectedFeature {
  readonly feature_id: string;
  readonly category: SaeFeatureCategory;
  readonly label: string;
  readonly activation_strength: number;
  readonly threshold_at_time: number;
}

export interface DetectFeaturesInput {
  readonly tenant_id: string;
  readonly activation: ActivationVector;
  readonly dictionary: ReadonlyArray<SaeFeatureDictionaryEntry>;
  readonly overrides?: ReadonlyArray<ThresholdOverride>;
}

/**
 * Forward-detect every feature in the dictionary against the supplied
 * activation. Empty result is normal — most turns fire zero features.
 */
export function detectFeatures(
  input: DetectFeaturesInput,
): ReadonlyArray<DetectedFeature> {
  if (!input.tenant_id) {
    throw new SaeProbeError('tenant_id required', 'MISSING_TENANT');
  }
  if (input.dictionary.length === 0) {
    throw new SaeProbeError(
      'dictionary must contain at least one feature',
      'EMPTY_DICTIONARY',
    );
  }
  if (input.activation.length === 0) {
    throw new SaeProbeError(
      'activation vector must not be empty',
      'INVALID_INPUT',
    );
  }

  const fired: Array<DetectedFeature> = [];
  for (const entry of input.dictionary) {
    if (entry.direction.length !== input.activation.length) {
      throw new SaeProbeError(
        `dimension mismatch: feature ${entry.feature_id} direction is ${entry.direction.length}d but activation is ${input.activation.length}d`,
        'DIMENSION_MISMATCH',
      );
    }
    const strength = reluLinear(entry.direction, input.activation, entry.bias);
    const effectiveThresholdInput = {
      entry,
      tenant_id: input.tenant_id,
      ...(input.overrides !== undefined ? { overrides: input.overrides } : {}),
    };
    const effectiveThreshold = resolveThreshold(effectiveThresholdInput);
    if (strength >= effectiveThreshold) {
      fired.push({
        feature_id: entry.feature_id,
        category: entry.category,
        label: entry.label,
        activation_strength: strength,
        threshold_at_time: effectiveThreshold,
      });
    }
  }
  return fired;
}

function reluLinear(
  direction: ReadonlyArray<number>,
  activation: ReadonlyArray<number>,
  bias: number,
): number {
  let acc = bias;
  for (let i = 0; i < direction.length; i += 1) {
    const d = direction[i];
    const a = activation[i];
    if (d === undefined || a === undefined) {
      // Defensive — covered by the dimension-mismatch check above.
      continue;
    }
    acc += d * a;
  }
  return acc > 0 ? acc : 0;
}

/**
 * Placeholder dictionary — one entry per category. Used in tests
 * and as a smoke contract before the real SAE training pipeline
 * lands in Phase 2.
 *
 * Each placeholder entry uses a unit basis-vector direction in a
 * shared 7-dimensional probe space so a test can drive a specific
 * feature into firing by setting the matching axis above the bias.
 */
export function getPlaceholderDictionary(): ReadonlyArray<SaeFeatureDictionaryEntry> {
  return SAE_FEATURE_CATEGORIES.map<SaeFeatureDictionaryEntry>(
    (category, idx) => ({
      feature_id: `sf-${category}-v0`,
      category,
      label: `placeholder:${category}`,
      direction: SAE_FEATURE_CATEGORIES.map((_, j) => (j === idx ? 1 : 0)),
      bias: 0,
      threshold: 1,
    }),
  );
}
