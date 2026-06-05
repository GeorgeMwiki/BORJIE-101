/**
 * Churn / retention hypotheses — 5 seeds.
 *
 * Mining-estate analogue: what drives a buyer / off-taker
 * counterparty to renew or walk away from an offtake relationship.
 */

import type { HypothesisSeed } from '../types.js';

export const CHURN_SEEDS: readonly HypothesisSeed[] = [
  {
    id: 'churn-01',
    area: 'churn',
    statement:
      'Counterparties who use the in-app dispatch feature 3+ times in month 1 renew at a higher rate than non-users.',
    variables: ['renewal_binary', 'dispatch_feature_uses_m1', 'price_band', 'site_id'],
    suggestedTreatmentVar: 'dispatch_feature_uses_m1',
    suggestedOutcomeVar: 'renewal_binary',
    suggestedConfounders: ['price_band', 'site_id'],
    suggestedEstimator: 'dml',
    owningPerspective: 'counterparty',
    tags: ['engagement', 'product_signal'],
  },
  {
    id: 'churn-02',
    area: 'churn',
    statement:
      'Single-page offtake documents produce a faster contract-sign cycle without changing suspension rates.',
    variables: ['days_to_sign', 'suspension_rate', 'offtake_doc_length_pages', 'counterparty_literacy_proxy'],
    suggestedTreatmentVar: 'offtake_doc_length_pages',
    suggestedOutcomeVar: 'days_to_sign',
    suggestedConfounders: ['counterparty_literacy_proxy'],
    suggestedEstimator: 'dml',
    owningPerspective: 'counterparty',
    tags: ['friction', 'doc_design'],
  },
  {
    id: 'churn-03',
    area: 'churn',
    statement:
      'Counterparties who decline the welcome-call show higher month-3 churn.',
    variables: ['churn_m3', 'welcome_call_declined', 'demographic_bucket'],
    suggestedTreatmentVar: 'welcome_call_declined',
    suggestedOutcomeVar: 'churn_m3',
    suggestedConfounders: ['demographic_bucket'],
    suggestedEstimator: 'dml',
    owningPerspective: 'counterparty',
    tags: ['onboarding', 'engagement'],
  },
  {
    id: 'churn-04',
    area: 'churn',
    statement:
      'Counterparties assigned the same site supervisor for 18+ months report 14% higher renewal rates.',
    variables: ['renewal_binary', 'supervisor_tenure_mo', 'site_id'],
    suggestedTreatmentVar: 'supervisor_tenure_mo',
    suggestedOutcomeVar: 'renewal_binary',
    suggestedConfounders: ['site_id'],
    suggestedEstimator: 'dml',
    owningPerspective: 'site_supervisor',
    tags: ['continuity', 'relationship'],
  },
  {
    id: 'churn-05',
    area: 'churn',
    statement:
      'Owners whose WhatsApp response time is under 4 hours see counterparty satisfaction +12 and renewal +6%.',
    variables: ['renewal_binary', 'counterparty_csat', 'owner_whatsapp_response_h', 'owner_archetype'],
    suggestedTreatmentVar: 'owner_whatsapp_response_h',
    suggestedOutcomeVar: 'renewal_binary',
    suggestedConfounders: ['owner_archetype'],
    suggestedEstimator: 'dml',
    owningPerspective: 'owner',
    tags: ['responsiveness', 'csat'],
  },
];
