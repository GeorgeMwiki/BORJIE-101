/**
 * owner-intent — utility helpers for the OwnerIntent value type.
 */

import type { OwnerIntent } from '../types.js';
import { defaultIntentFor } from '../world-model/business-archetype.js';
import type { BusinessArchetype } from '../types.js';

export function intentFor(arch: BusinessArchetype): OwnerIntent {
  return defaultIntentFor(arch);
}

export function blendIntents(
  a: OwnerIntent,
  b: OwnerIntent,
  weightOfA: number,
): OwnerIntent {
  const wa = Math.min(1, Math.max(0, weightOfA));
  const wb = 1 - wa;
  return {
    archetype: wa >= 0.5 ? a.archetype : b.archetype,
    weights: {
      cashflow: a.weights.cashflow * wa + b.weights.cashflow * wb,
      retention: a.weights.retention * wa + b.weights.retention * wb,
      compliance: a.weights.compliance * wa + b.weights.compliance * wb,
      intentAlignment:
        a.weights.intentAlignment * wa + b.weights.intentAlignment * wb,
    },
    riskTolerance: a.riskTolerance * wa + b.riskTolerance * wb,
  };
}
