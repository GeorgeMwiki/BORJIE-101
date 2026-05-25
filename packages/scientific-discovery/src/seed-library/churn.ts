/**
 * Churn / retention hypotheses — 5 seeds.
 *
 * Mirrors entries 9, 14, 15, 22, 23 from §10 of the research report.
 */

import type { HypothesisSeed } from '../types.js';

export const CHURN_SEEDS: readonly HypothesisSeed[] = [
  {
    id: 'churn-01',
    area: 'churn',
    statement:
      'Tenants who use the in-app maintenance feature 3+ times in month 1 renew at a higher rate than non-users.',
    variables: ['renewal_binary', 'maintenance_feature_uses_m1', 'rent_band', 'building_id'],
    suggestedTreatmentVar: 'maintenance_feature_uses_m1',
    suggestedOutcomeVar: 'renewal_binary',
    suggestedConfounders: ['rent_band', 'building_id'],
    suggestedEstimator: 'dml',
    owningPerspective: 'tenant',
    tags: ['engagement', 'product_signal'],
  },
  {
    id: 'churn-02',
    area: 'churn',
    statement:
      'Single-page lease documents produce a faster lease-sign cycle without changing eviction rates.',
    variables: ['days_to_sign', 'eviction_rate', 'lease_doc_length_pages', 'tenant_literacy_proxy'],
    suggestedTreatmentVar: 'lease_doc_length_pages',
    suggestedOutcomeVar: 'days_to_sign',
    suggestedConfounders: ['tenant_literacy_proxy'],
    suggestedEstimator: 'dml',
    owningPerspective: 'tenant',
    tags: ['friction', 'doc_design'],
  },
  {
    id: 'churn-03',
    area: 'churn',
    statement:
      'Tenants who decline the welcome-call show higher month-3 churn.',
    variables: ['churn_m3', 'welcome_call_declined', 'demographic_bucket'],
    suggestedTreatmentVar: 'welcome_call_declined',
    suggestedOutcomeVar: 'churn_m3',
    suggestedConfounders: ['demographic_bucket'],
    suggestedEstimator: 'dml',
    owningPerspective: 'tenant',
    tags: ['onboarding', 'engagement'],
  },
  {
    id: 'churn-04',
    area: 'churn',
    statement:
      'Tenants assigned the same caretaker for 18+ months report 14% higher renewal rates.',
    variables: ['renewal_binary', 'caretaker_tenure_mo', 'building_id'],
    suggestedTreatmentVar: 'caretaker_tenure_mo',
    suggestedOutcomeVar: 'renewal_binary',
    suggestedConfounders: ['building_id'],
    suggestedEstimator: 'dml',
    owningPerspective: 'caretaker',
    tags: ['continuity', 'relationship'],
  },
  {
    id: 'churn-05',
    area: 'churn',
    statement:
      'Owners whose WhatsApp response time is under 4 hours see tenant NPS +12 and renewal +6%.',
    variables: ['renewal_binary', 'tenant_nps', 'owner_whatsapp_response_h', 'owner_archetype'],
    suggestedTreatmentVar: 'owner_whatsapp_response_h',
    suggestedOutcomeVar: 'renewal_binary',
    suggestedConfounders: ['owner_archetype'],
    suggestedEstimator: 'dml',
    owningPerspective: 'owner',
    tags: ['responsiveness', 'nps'],
  },
];
