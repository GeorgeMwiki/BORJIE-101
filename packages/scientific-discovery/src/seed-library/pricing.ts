/**
 * Pricing / NOI-driver hypotheses — 5 seeds.
 *
 * Mirrors entries 2, 7, 17, 20, 21 from §10 of the research report.
 */

import type { HypothesisSeed } from '../types.js';

export const PRICING_SEEDS: readonly HypothesisSeed[] = [
  {
    id: 'pricing-01',
    area: 'pricing',
    statement:
      'Adding a gym amenity increases collection-rate but only above a rent threshold of approximately KES 60k/month.',
    variables: ['collection_rate_pct', 'gym_installed_binary', 'rent_amount', 'building_age_years', 'tenant_income_proxy'],
    suggestedTreatmentVar: 'gym_installed_binary',
    suggestedOutcomeVar: 'collection_rate_pct',
    suggestedConfounders: ['rent_amount', 'building_age_years', 'tenant_income_proxy'],
    suggestedEstimator: 'causal_forest',
    owningPerspective: 'owner',
    jurisdictions: ['KE'],
    tags: ['amenity', 'threshold_effect'],
  },
  {
    id: 'pricing-02',
    area: 'pricing',
    statement:
      'Rent raises above 7% trigger above-baseline churn within 90 days.',
    variables: ['churn_90d', 'rent_raise_pct_binned', 'lease_tenure_mo', 'market_rent_delta'],
    suggestedTreatmentVar: 'rent_raise_pct_binned',
    suggestedOutcomeVar: 'churn_90d',
    suggestedConfounders: ['lease_tenure_mo', 'market_rent_delta'],
    suggestedEstimator: 'causalpy_its',
    owningPerspective: 'owner',
    tags: ['elasticity', 'threshold'],
  },
  {
    id: 'pricing-03',
    area: 'pricing',
    statement:
      'Owners who reject 3+ suggested rent updates in a year see 8% lower year-on-year NOI than those who accept.',
    variables: ['yoy_noi_pct', 'owner_rejection_rate', 'portfolio_size', 'area_code'],
    suggestedTreatmentVar: 'owner_rejection_rate',
    suggestedOutcomeVar: 'yoy_noi_pct',
    suggestedConfounders: ['portfolio_size', 'area_code'],
    suggestedEstimator: 'dml',
    owningPerspective: 'owner',
    tags: ['advice_adoption', 'noi'],
  },
  {
    id: 'pricing-04',
    area: 'pricing',
    statement:
      'Listings whose photo-quality score exceeds 0.8 fill 19% faster than equivalent listings below 0.5.',
    variables: ['days_to_fill', 'photo_quality_score', 'rent_amount', 'unit_type', 'area_code'],
    suggestedTreatmentVar: 'photo_quality_score',
    suggestedOutcomeVar: 'days_to_fill',
    suggestedConfounders: ['rent_amount', 'unit_type', 'area_code'],
    suggestedEstimator: 'dml',
    owningPerspective: 'owner',
    tags: ['listing_quality', 'visual'],
  },
  {
    id: 'pricing-05',
    area: 'pricing',
    statement:
      'Leases ending in December–January suffer 22% longer subsequent vacancy than leases ending in April–May.',
    variables: ['vacancy_duration_days', 'lease_end_month', 'unit_type'],
    suggestedTreatmentVar: 'lease_end_month',
    suggestedOutcomeVar: 'vacancy_duration_days',
    suggestedConfounders: ['unit_type'],
    suggestedEstimator: 'causalpy_synthetic_control',
    owningPerspective: 'owner',
    tags: ['seasonality', 'lease_calendar'],
  },
];
