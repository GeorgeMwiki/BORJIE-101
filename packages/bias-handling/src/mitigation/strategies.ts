/**
 * Catalog of registered mitigation strategies — for UI / reports.
 */

import type { MitigationStrategy } from '../types.js';

export const MITIGATION_STRATEGIES: ReadonlyArray<MitigationStrategy> = [
  {
    id: 'reweigh',
    tier: 'pre_processing',
    description:
      'Reweighing (Kamiran & Calders 2012). Per-instance weights such that P(A, Y) matches P(A) × P(Y).',
    tradeoffs: [
      'Requires downstream learner that supports sample weights.',
      'Does not address bias in correlated proxy features.',
      'Weights can be unstable for tiny strata.',
    ],
  },
  {
    id: 'learned_fair_representations',
    tier: 'pre_processing',
    description:
      'Drop protected proxy fields and optionally bucketise remaining numeric fields (config-driven, Zemel et al. 2013 inspired).',
    tradeoffs: [
      'Manual proxy list — risk of missed proxies.',
      'Bucketising hurts utility on continuous features.',
      'No causal guarantees — pair with counterfactual checks.',
    ],
  },
  {
    id: 'fairness_constraint',
    tier: 'in_processing',
    description:
      'Lagrangian penalty on the training loss — increase λ until constraint is met (Agarwal et al. 2018 reduction).',
    tradeoffs: [
      'Strict constraints can hurt accuracy.',
      'Requires inner trainer that consumes λ.',
      'Not all constraints are jointly feasible (Pleiss et al. 2017 impossibility).',
    ],
  },
  {
    id: 'adversarial_debiasing',
    tier: 'in_processing',
    description:
      'Train predictor + adversary jointly so adversary cannot recover the protected attribute from predictor output (Zhang et al. 2018).',
    tradeoffs: [
      'Needs differentiable framework — adapter only here.',
      'Optimisation is unstable.',
      'Strong adversary can collapse predictor.',
    ],
  },
  {
    id: 'equalized_odds_postprocess',
    tier: 'post_processing',
    description:
      'Per-group decision thresholds chosen on a calibration set to equalise TPR + FPR (Hardt et al. 2016).',
    tradeoffs: [
      'Different decision rule per protected class — disparate-treatment risk.',
      'Needs holdout calibration data.',
      'May hurt overall accuracy.',
    ],
  },
  {
    id: 'reject_option_classification',
    tier: 'post_processing',
    description:
      'Flip predictions in a confidence band around 0.5 in favour of the unprivileged group (Kamiran et al. 2012).',
    tradeoffs: [
      'Margin width must be tuned.',
      'Only operates near the boundary.',
      'Per-group flips can be flagged as disparate treatment.',
    ],
  },
];
