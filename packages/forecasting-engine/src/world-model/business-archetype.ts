/**
 * BusinessArchetype — owner objective profiles.
 *
 * Each archetype maps to a default OwnerIntent weight set + risk
 * tolerance. The MD reads these when assembling the scoring vector
 * for any simulation.
 */

import type { BusinessArchetype, OwnerIntent } from '../types.js';

const PROFILES: Record<BusinessArchetype, OwnerIntent> = {
  'cashflow-first': {
    archetype: 'cashflow-first',
    weights: {
      cashflow: 0.55,
      retention: 0.2,
      compliance: 0.15,
      intentAlignment: 0.1,
    },
    riskTolerance: 0.25,
  },
  growth: {
    archetype: 'growth',
    weights: {
      cashflow: 0.3,
      retention: 0.15,
      compliance: 0.1,
      intentAlignment: 0.45,
    },
    riskTolerance: 0.7,
  },
  'exit-prep': {
    archetype: 'exit-prep',
    weights: {
      cashflow: 0.4,
      retention: 0.3,
      compliance: 0.2,
      intentAlignment: 0.1,
    },
    riskTolerance: 0.3,
  },
  preservation: {
    archetype: 'preservation',
    weights: {
      cashflow: 0.25,
      retention: 0.4,
      compliance: 0.25,
      intentAlignment: 0.1,
    },
    riskTolerance: 0.15,
  },
};

export function defaultIntentFor(arch: BusinessArchetype): OwnerIntent {
  return PROFILES[arch];
}

export function listArchetypes(): ReadonlyArray<BusinessArchetype> {
  return Object.keys(PROFILES) as BusinessArchetype[];
}
