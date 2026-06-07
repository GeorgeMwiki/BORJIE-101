/**
 * Group-fairness gate over a fixture decision set.
 *
 * The LLM bias suites measure how the brain *talks*. This module
 * measures how an allocation decision *distributes* outcomes across
 * protected groups, using the AIF360-style metrics in
 * `@borjie/bias-handling` plus the per-jurisdiction protected-attribute
 * map. It is a separate, complementary CI signal.
 *
 * The fixture mirrors a Borjie-shaped allocation decision (e.g. who is
 * cleared for a payout / counterparty onboarding) labelled with a
 * protected attribute. We compute disparate impact + demographic parity
 * and gate on the statutory 80%-rule floor (EEOC 29 CFR §1607.4(D)).
 */

import {
  demographicParity,
  disparateImpact,
  getApplicableProtections,
  type DisparityScore,
  type FairnessRow,
  type ProtectedAttribute,
} from '@borjie/bias-handling';

export interface GroupFairnessResult {
  readonly jurisdiction: string;
  readonly protectedAttributes: ReadonlyArray<ProtectedAttribute>;
  readonly disparateImpact: DisparityScore;
  readonly demographicParity: DisparityScore;
  /** True when every gated metric is within its statutory threshold. */
  readonly passes: boolean;
}

/**
 * A small BALANCED fixture — selection rates are close across groups so
 * a correctly-wired metric reports `violates: false`. An adversarial
 * fixture (see `__tests__`) flips this, proving the metric discriminates.
 */
export const BALANCED_DECISION_FIXTURE: ReadonlyArray<FairnessRow> = Object.freeze([
  // privileged group "male": 6/10 selected
  ...repeat({ group: 'male', prediction: 1 }, 6),
  ...repeat({ group: 'male', prediction: 0 }, 4),
  // unprivileged group "female": 5/10 selected (ratio 0.83 ≥ 0.8 floor)
  ...repeat({ group: 'female', prediction: 1 }, 5),
  ...repeat({ group: 'female', prediction: 0 }, 5),
]);

function repeat(row: FairnessRow, n: number): ReadonlyArray<FairnessRow> {
  return Array.from({ length: n }, () => ({ ...row }));
}

/**
 * Score a decision set for group fairness.
 *
 * @param rows            per-subject prediction rows tagged with the
 *                        protected group value.
 * @param privilegedGroup the reference group for disparate impact.
 * @param jurisdiction    selects the applicable protected-attribute map
 *                        (e.g. 'TZ', 'KE', 'US-federal').
 */
export function scoreGroupFairness(args: {
  readonly rows: ReadonlyArray<FairnessRow>;
  readonly privilegedGroup: string;
  readonly jurisdiction: string;
  readonly context?: 'housing' | 'credit' | 'employment' | 'generic';
}): GroupFairnessResult {
  const protectedAttributes = getApplicableProtections(
    args.context !== undefined
      ? { jurisdiction: args.jurisdiction, context: args.context }
      : { jurisdiction: args.jurisdiction },
  );
  const di = disparateImpact({
    rows: args.rows,
    privilegedGroup: args.privilegedGroup,
  });
  const dp = demographicParity({ rows: args.rows });
  const passes = !di.violates && !dp.violates;
  return {
    jurisdiction: args.jurisdiction,
    protectedAttributes,
    disparateImpact: di,
    demographicParity: dp,
    passes,
  };
}
