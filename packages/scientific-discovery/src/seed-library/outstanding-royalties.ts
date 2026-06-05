/**
 * Outstanding-royalties-driver hypotheses — 5 seeds.
 *
 * Mining-estate analogue of the LITFIN arrears seeds: what drives a
 * counterparty to fall behind on royalty / offtake payments and how
 * recoverable that position is.
 */

import type { HypothesisSeed } from '../types.js';

export const OUTSTANDING_ROYALTIES_SEEDS: readonly HypothesisSeed[] = [
  {
    id: 'outstanding_royalties-01',
    area: 'outstanding_royalties',
    statement:
      'M-Pesa-paying counterparties have lower 6-month default probability than cash-paying counterparties, after controlling for solvency proxy and offtake tenure.',
    variables: ['default_within_6mo', 'payment_method', 'counterparty_solvency_proxy', 'offtake_tenure_mo'],
    suggestedTreatmentVar: 'payment_method',
    suggestedOutcomeVar: 'default_within_6mo',
    suggestedConfounders: ['counterparty_solvency_proxy', 'offtake_tenure_mo'],
    suggestedEstimator: 'causal_forest',
    owningPerspective: 'underwriter',
    jurisdictions: ['KE', 'TZ'],
    tags: ['payment_channel', 'risk'],
  },
  {
    id: 'outstanding_royalties-02',
    area: 'outstanding_royalties',
    statement:
      'Friday royalty-due dates yield higher on-time payment than 1st-of-month due dates, mediated by buyer cash cycle.',
    variables: ['on_time_payment', 'due_day_of_month', 'buyer_sector_proxy'],
    suggestedTreatmentVar: 'due_day_of_month',
    suggestedOutcomeVar: 'on_time_payment',
    suggestedConfounders: ['buyer_sector_proxy'],
    suggestedEstimator: 'dml',
    owningPerspective: 'owner',
    tags: ['cadence', 'on_time'],
  },
  {
    id: 'outstanding_royalties-03',
    area: 'outstanding_royalties',
    statement:
      'Onboarding KYC completion under 24 hours correlates with lower 90-day default risk.',
    variables: ['default_90d', 'kyc_completion_hours', 'counterparty_solvency_proxy', 'buyer_type'],
    suggestedTreatmentVar: 'kyc_completion_hours',
    suggestedOutcomeVar: 'default_90d',
    suggestedConfounders: ['counterparty_solvency_proxy', 'buyer_type'],
    suggestedEstimator: 'dml',
    owningPerspective: 'underwriter',
    tags: ['onboarding', 'early_signal'],
  },
  {
    id: 'outstanding_royalties-04',
    area: 'outstanding_royalties',
    statement:
      'Counterparties who pay via mobile-money 24+ hours before due-date show 0% default in the following cycle.',
    variables: ['default_next_cycle', 'early_payment_flag', 'counterparty_solvency_proxy', 'offtake_tenure_mo'],
    suggestedTreatmentVar: 'early_payment_flag',
    suggestedOutcomeVar: 'default_next_cycle',
    suggestedConfounders: ['counterparty_solvency_proxy', 'offtake_tenure_mo'],
    suggestedEstimator: 'causal_forest',
    owningPerspective: 'underwriter',
    tags: ['behavioural_signal'],
  },
  {
    id: 'outstanding_royalties-05',
    area: 'outstanding_royalties',
    statement:
      'Outstanding royalties exceeding 1.5× the monthly payment is a point of no return: collection probability falls below 5%.',
    variables: ['recovery_prob', 'outstanding_ratio', 'counterparty_solvency_proxy'],
    suggestedTreatmentVar: 'outstanding_ratio',
    suggestedOutcomeVar: 'recovery_prob',
    suggestedConfounders: ['counterparty_solvency_proxy'],
    suggestedEstimator: 'causalpy_its',
    owningPerspective: 'auditor',
    tags: ['threshold', 'recovery'],
  },
];
