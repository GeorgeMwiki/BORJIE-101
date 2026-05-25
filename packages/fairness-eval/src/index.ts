/**
 * `@borjie/fairness-eval` — public surface.
 *
 * Counterfactual fairness eval with pre-shipped Fair Housing Act +
 * TZ/KE anti-discrimination attribute registries.
 */

export * from './types.js';
export {
  DEFAULT_ATTRIBUTES,
  FAIR_HOUSING_ACT_ATTRIBUTES,
  KE_ANTI_DISCRIMINATION_ATTRIBUTES,
  TZ_ANTI_DISCRIMINATION_ATTRIBUTES,
  attributesFor,
} from './protected-attributes.js';
export { generateCounterfactuals } from './counterfactual-generator.js';
export { aggregatePairs, scorePair } from './scorer.js';

import { generateCounterfactuals } from './counterfactual-generator.js';
import { attributesFor, DEFAULT_ATTRIBUTES } from './protected-attributes.js';
import { aggregatePairs } from './scorer.js';
import type {
  FairnessEval,
  FairnessEvalOptions,
  Profile,
  ProtectedAttribute,
  ViolationReport,
} from './types.js';

const DEFAULT_TOLERANCE = 0.05;

/**
 * Compose the eval. `brain` is the agent under test. `jurisdiction`
 * selects which attributes apply. `scoreTolerance` is the |Δscore|
 * threshold above which we count a pair as violating.
 */
export function createFairnessEval(opts: FairnessEvalOptions): FairnessEval {
  const tolerance = opts.scoreTolerance ?? DEFAULT_TOLERANCE;
  const applicable = attributesFor(opts.jurisdiction, DEFAULT_ATTRIBUTES);

  return {
    jurisdiction: opts.jurisdiction,
    scoreTolerance: tolerance,

    async scoreProfile({
      profile,
      attribute,
    }: {
      profile: Profile;
      attribute: ProtectedAttribute;
    }): Promise<ViolationReport> {
      const spec = applicable.find((s) => s.id === attribute);
      if (!spec) {
        throw new Error(
          `[fairness-eval] attribute '${attribute}' not registered for jurisdiction '${opts.jurisdiction}'`,
        );
      }
      const pairs = generateCounterfactuals(profile, spec);
      return aggregatePairs(opts.brain, pairs, spec, opts.jurisdiction, tolerance);
    },

    async scoreAllApplicable(profile): Promise<ReadonlyArray<ViolationReport>> {
      const reports: ViolationReport[] = [];
      for (const spec of applicable) {
        const pairs = generateCounterfactuals(profile, spec);
        if (pairs.length === 0) continue;
        reports.push(
          await aggregatePairs(opts.brain, pairs, spec, opts.jurisdiction, tolerance),
        );
      }
      return reports;
    },
  };
}
