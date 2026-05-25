/**
 * Maintenance-driver hypotheses — 5 seeds.
 *
 * Mirrors entries 5, 6, 11, 16, 24 from §10 of the research report.
 */

import type { HypothesisSeed } from '../types.js';

export const MAINTENANCE_SEEDS: readonly HypothesisSeed[] = [
  {
    id: 'maintenance-01',
    area: 'maintenance',
    statement:
      'Female caretakers receive fewer maintenance complaints per unit-year than male caretakers, controlling for building age and unit count.',
    variables: ['tickets_per_unit_year', 'caretaker_gender', 'building_age_years', 'unit_count'],
    suggestedTreatmentVar: 'caretaker_gender',
    suggestedOutcomeVar: 'tickets_per_unit_year',
    suggestedConfounders: ['building_age_years', 'unit_count'],
    suggestedEstimator: 'dml',
    owningPerspective: 'caretaker',
    tags: ['staffing', 'sensitive_attribute'],
  },
  {
    id: 'maintenance-02',
    area: 'maintenance',
    statement:
      'Solar-hot-water installation reduces KPLC bill complaints and lifts renewal rate.',
    variables: ['renewal_rate', 'solar_hot_water_installed', 'rent_band', 'area_code'],
    suggestedTreatmentVar: 'solar_hot_water_installed',
    suggestedOutcomeVar: 'renewal_rate',
    suggestedConfounders: ['rent_band', 'area_code'],
    suggestedEstimator: 'causalpy_synthetic_control',
    owningPerspective: 'owner',
    jurisdictions: ['KE'],
    tags: ['capex', 'energy'],
  },
  {
    id: 'maintenance-03',
    area: 'maintenance',
    statement:
      'Late-night (22:00–05:00) maintenance tickets predict eviction within 6 months.',
    variables: ['eviction_binary_6mo', 'late_night_ticket_rate', 'lease_tenure_mo', 'household_size'],
    suggestedTreatmentVar: 'late_night_ticket_rate',
    suggestedOutcomeVar: 'eviction_binary_6mo',
    suggestedConfounders: ['lease_tenure_mo', 'household_size'],
    suggestedEstimator: 'pcmciplus',
    owningPerspective: 'auditor',
    tags: ['leading_indicator', 'eviction'],
  },
  {
    id: 'maintenance-04',
    area: 'maintenance',
    statement:
      'Vendor concentration above 60% of spend with a single plumber doubles ticket recurrence.',
    variables: ['ticket_recurrence_rate', 'vendor_hhi', 'building_age_years'],
    suggestedTreatmentVar: 'vendor_hhi',
    suggestedOutcomeVar: 'ticket_recurrence_rate',
    suggestedConfounders: ['building_age_years'],
    suggestedEstimator: 'dml',
    owningPerspective: 'vendor',
    tags: ['vendor_mix', 'recurrence'],
  },
  {
    id: 'maintenance-05',
    area: 'maintenance',
    statement:
      'Post-fire insurance-claim events have a 6-month lookback showing missed maintenance tickets in 78% of cases.',
    variables: ['insurance_claim_fire', 'missed_maintenance_lookback_6mo', 'building_age_years', 'vendor_quality_score'],
    suggestedTreatmentVar: 'missed_maintenance_lookback_6mo',
    suggestedOutcomeVar: 'insurance_claim_fire',
    suggestedConfounders: ['building_age_years', 'vendor_quality_score'],
    suggestedEstimator: 'dowhy_linear',
    owningPerspective: 'regulator',
    tags: ['safety', 'retrospective'],
  },
];
