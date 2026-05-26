/**
 * Threshold policy (Wave 18BB-gap, research-grade stub).
 *
 * Resolves the firing threshold for a given `(feature_id, tenant_id)`
 * pair. Order of precedence:
 *
 *   1. tenant-specific override  (rare; only with written justification)
 *   2. dictionary entry's baseline threshold
 *
 * Anti-pattern §6.5 of the spec forbids cross-tenant feature reuse;
 * tenant-specific SAEs are Phase 2 work. Until then, the threshold
 * override mechanism is the only per-tenant lever.
 */

import {
  SaeProbeError,
  type SaeFeatureDictionaryEntry,
  type ThresholdOverride,
} from '../types.js';

export interface ResolveThresholdInput {
  readonly entry: SaeFeatureDictionaryEntry;
  readonly tenant_id: string;
  readonly overrides?: ReadonlyArray<ThresholdOverride>;
}

export function resolveThreshold(input: ResolveThresholdInput): number {
  if (!input.tenant_id) {
    throw new SaeProbeError('tenant_id required', 'MISSING_TENANT');
  }
  if (input.entry.threshold < 0) {
    throw new SaeProbeError(
      `dictionary threshold ${input.entry.threshold} negative`,
      'INVALID_THRESHOLD',
    );
  }
  const overrides = input.overrides ?? [];
  const match = overrides.find(
    (o) =>
      o.feature_id === input.entry.feature_id &&
      o.tenant_id === input.tenant_id,
  );
  if (match) {
    if (match.threshold < 0) {
      throw new SaeProbeError(
        `override threshold ${match.threshold} negative`,
        'INVALID_THRESHOLD',
      );
    }
    return match.threshold;
  }
  return input.entry.threshold;
}
