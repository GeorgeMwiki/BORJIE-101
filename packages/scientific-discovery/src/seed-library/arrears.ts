/**
 * Arrears-driver hypotheses — 5 seeds.
 *
 * Mirrors entries 3, 4, 10, 13, 19 from §10 of the research report.
 */

import type { HypothesisSeed } from '../types.js';

export const ARREARS_SEEDS: readonly HypothesisSeed[] = [
  {
    id: 'arrears-01',
    area: 'arrears',
    statement:
      'M-Pesa-paying tenants have lower 6-month default probability than cash-paying tenants, after controlling for income proxy and lease tenure.',
    variables: ['default_within_6mo', 'payment_method', 'tenant_income_proxy', 'lease_tenure_mo'],
    suggestedTreatmentVar: 'payment_method',
    suggestedOutcomeVar: 'default_within_6mo',
    suggestedConfounders: ['tenant_income_proxy', 'lease_tenure_mo'],
    suggestedEstimator: 'causal_forest',
    owningPerspective: 'underwriter',
    jurisdictions: ['KE', 'TZ'],
    tags: ['payment_channel', 'risk'],
  },
  {
    id: 'arrears-02',
    area: 'arrears',
    statement:
      'Friday rent-due dates yield higher on-time payment than 1st-of-month due dates, mediated by salary cadence.',
    variables: ['on_time_payment', 'due_day_of_month', 'industry_code_proxy'],
    suggestedTreatmentVar: 'due_day_of_month',
    suggestedOutcomeVar: 'on_time_payment',
    suggestedConfounders: ['industry_code_proxy'],
    suggestedEstimator: 'dml',
    owningPerspective: 'owner',
    tags: ['cadence', 'on_time'],
  },
  {
    id: 'arrears-03',
    area: 'arrears',
    statement:
      'Onboarding KYC completion under 24 hours correlates with lower 90-day default risk.',
    variables: ['default_90d', 'kyc_completion_hours', 'tenant_income_proxy', 'employer_type'],
    suggestedTreatmentVar: 'kyc_completion_hours',
    suggestedOutcomeVar: 'default_90d',
    suggestedConfounders: ['tenant_income_proxy', 'employer_type'],
    suggestedEstimator: 'dml',
    owningPerspective: 'underwriter',
    tags: ['onboarding', 'early_signal'],
  },
  {
    id: 'arrears-04',
    area: 'arrears',
    statement:
      'Tenants who pay via mobile-money 24+ hours before due-date show 0% default in the following cycle.',
    variables: ['default_next_cycle', 'early_payment_flag', 'tenant_income_proxy', 'lease_tenure_mo'],
    suggestedTreatmentVar: 'early_payment_flag',
    suggestedOutcomeVar: 'default_next_cycle',
    suggestedConfounders: ['tenant_income_proxy', 'lease_tenure_mo'],
    suggestedEstimator: 'causal_forest',
    owningPerspective: 'underwriter',
    tags: ['behavioural_signal'],
  },
  {
    id: 'arrears-05',
    area: 'arrears',
    statement:
      'Rent arrears exceeding 1.5× monthly rent is a point of no return: collection probability falls below 5%.',
    variables: ['recovery_prob', 'arrears_ratio', 'tenant_income_proxy'],
    suggestedTreatmentVar: 'arrears_ratio',
    suggestedOutcomeVar: 'recovery_prob',
    suggestedConfounders: ['tenant_income_proxy'],
    suggestedEstimator: 'causalpy_its',
    owningPerspective: 'auditor',
    tags: ['threshold', 'recovery'],
  },
];
