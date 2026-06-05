/**
 * Pricing / net-margin-driver hypotheses — 5 seeds.
 *
 * Mining-estate analogue: what drives realised offtake price,
 * collection rate, and net margin on contracted production.
 */

import type { HypothesisSeed } from '../types.js';

export const PRICING_SEEDS: readonly HypothesisSeed[] = [
  {
    id: 'pricing-01',
    area: 'pricing',
    statement:
      'Adding on-site assay certification increases collection-rate but only above an offtake price threshold of approximately KES 60k/tonne.',
    variables: ['collection_rate_pct', 'onsite_assay_binary', 'offtake_price', 'site_age_years', 'counterparty_solvency_proxy'],
    suggestedTreatmentVar: 'onsite_assay_binary',
    suggestedOutcomeVar: 'collection_rate_pct',
    suggestedConfounders: ['offtake_price', 'site_age_years', 'counterparty_solvency_proxy'],
    suggestedEstimator: 'causal_forest',
    owningPerspective: 'owner',
    jurisdictions: ['KE'],
    tags: ['certification', 'threshold_effect'],
  },
  {
    id: 'pricing-02',
    area: 'pricing',
    statement:
      'Royalty raises above 7% trigger above-baseline churn within 90 days.',
    variables: ['churn_90d', 'royalty_raise_pct_binned', 'offtake_tenure_mo', 'market_price_delta'],
    suggestedTreatmentVar: 'royalty_raise_pct_binned',
    suggestedOutcomeVar: 'churn_90d',
    suggestedConfounders: ['offtake_tenure_mo', 'market_price_delta'],
    suggestedEstimator: 'causalpy_its',
    owningPerspective: 'owner',
    tags: ['elasticity', 'threshold'],
  },
  {
    id: 'pricing-03',
    area: 'pricing',
    statement:
      'Owners who reject 3+ suggested price updates in a year see 8% lower year-on-year net margin than those who accept.',
    variables: ['yoy_margin_pct', 'owner_rejection_rate', 'estate_size', 'area_code'],
    suggestedTreatmentVar: 'owner_rejection_rate',
    suggestedOutcomeVar: 'yoy_margin_pct',
    suggestedConfounders: ['estate_size', 'area_code'],
    suggestedEstimator: 'dml',
    owningPerspective: 'owner',
    tags: ['advice_adoption', 'net_margin'],
  },
  {
    id: 'pricing-04',
    area: 'pricing',
    statement:
      'Listings whose assay-evidence score exceeds 0.8 are contracted 19% faster than equivalent listings below 0.5.',
    variables: ['days_to_contract', 'assay_evidence_score', 'offtake_price', 'unit_type', 'area_code'],
    suggestedTreatmentVar: 'assay_evidence_score',
    suggestedOutcomeVar: 'days_to_contract',
    suggestedConfounders: ['offtake_price', 'unit_type', 'area_code'],
    suggestedEstimator: 'dml',
    owningPerspective: 'owner',
    tags: ['listing_quality', 'evidence'],
  },
  {
    id: 'pricing-05',
    area: 'pricing',
    statement:
      'Offtakes ending in December–January suffer 22% longer subsequent idle capacity than offtakes ending in April–May.',
    variables: ['idle_duration_days', 'offtake_end_month', 'unit_type'],
    suggestedTreatmentVar: 'offtake_end_month',
    suggestedOutcomeVar: 'idle_duration_days',
    suggestedConfounders: ['unit_type'],
    suggestedEstimator: 'causalpy_synthetic_control',
    owningPerspective: 'owner',
    tags: ['seasonality', 'offtake_calendar'],
  },
];
