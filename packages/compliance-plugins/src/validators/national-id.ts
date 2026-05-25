/**
 * Universal national-ID validator — dispatches to the per-country validator
 * attached to the country plugin's `ExtendedCountryProfile`. Returns a
 * 'validation-unavailable' verdict (NOT 'invalid') when no rule is known,
 * so tenants in unsupported jurisdictions still onboard.
 */

import type { IdValidationResult } from '../countries/types.js';

/** Resolver the validator uses to find the per-country rule. Kept abstract to
 * avoid a cyclic import — `countries/index.ts` injects the real resolver. */
export type NationalIdResolver = (
  iso: string
) => { validate(raw: string): IdValidationResult } | null;

/** Default resolver — returns null for every code (useful for unit tests). */
const NOOP_RESOLVER: NationalIdResolver = () => null;

let activeResolver: NationalIdResolver = NOOP_RESOLVER;

export function setNationalIdResolver(resolver: NationalIdResolver): void {
  activeResolver = resolver;
}

export function __resetNationalIdResolver(): void {
  activeResolver = NOOP_RESOLVER;
}

export function validateNationalId(
  raw: string,
  countryCode: string
): IdValidationResult {
  if (!raw || raw.trim().length === 0) {
    return {
      status: 'invalid',
      ruleId: 'universal',
      note: 'National ID is empty.',
    };
  }
  const iso = countryCode.trim().toUpperCase();
  if (!iso) {
    return {
      status: 'validation-unavailable',
      ruleId: 'universal',
      note: 'Country code missing — cannot dispatch validator.',
    };
  }
  const validator = activeResolver(iso);
  if (!validator) {
    return {
      status: 'validation-unavailable',
      ruleId: 'universal',
      note: `No national-ID validator registered for ${iso}.`,
    };
  }
  return validator.validate(raw);
}
