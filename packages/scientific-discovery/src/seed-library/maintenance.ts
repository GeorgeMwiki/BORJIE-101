/**
 * Maintenance-driver hypotheses — 5 seeds.
 *
 * Mining-estate analogue: what drives equipment / plant maintenance
 * load, recurrence, and downstream safety / production outcomes.
 */

import type { HypothesisSeed } from '../types.js';

export const MAINTENANCE_SEEDS: readonly HypothesisSeed[] = [
  {
    id: 'maintenance-01',
    area: 'maintenance',
    statement:
      'Female site supervisors receive fewer maintenance complaints per unit-year than male supervisors, controlling for site age and unit count.',
    variables: ['tickets_per_unit_year', 'supervisor_gender', 'site_age_years', 'unit_count'],
    suggestedTreatmentVar: 'supervisor_gender',
    suggestedOutcomeVar: 'tickets_per_unit_year',
    suggestedConfounders: ['site_age_years', 'unit_count'],
    suggestedEstimator: 'dml',
    owningPerspective: 'site_supervisor',
    tags: ['staffing', 'sensitive_attribute'],
  },
  {
    id: 'maintenance-02',
    area: 'maintenance',
    statement:
      'Solar-hybrid genset installation reduces grid-power outage complaints and lifts offtake renewal rate.',
    variables: ['renewal_rate', 'solar_hybrid_installed', 'price_band', 'area_code'],
    suggestedTreatmentVar: 'solar_hybrid_installed',
    suggestedOutcomeVar: 'renewal_rate',
    suggestedConfounders: ['price_band', 'area_code'],
    suggestedEstimator: 'causalpy_synthetic_control',
    owningPerspective: 'owner',
    jurisdictions: ['KE'],
    tags: ['capex', 'energy'],
  },
  {
    id: 'maintenance-03',
    area: 'maintenance',
    statement:
      'Late-night (22:00–05:00) plant-maintenance tickets predict licence suspension within 6 months.',
    variables: ['suspension_binary_6mo', 'late_night_ticket_rate', 'offtake_tenure_mo', 'crew_size'],
    suggestedTreatmentVar: 'late_night_ticket_rate',
    suggestedOutcomeVar: 'suspension_binary_6mo',
    suggestedConfounders: ['offtake_tenure_mo', 'crew_size'],
    suggestedEstimator: 'pcmciplus',
    owningPerspective: 'auditor',
    tags: ['leading_indicator', 'licence_suspension'],
  },
  {
    id: 'maintenance-04',
    area: 'maintenance',
    statement:
      'Vendor concentration above 60% of spend with a single fitter doubles ticket recurrence.',
    variables: ['ticket_recurrence_rate', 'vendor_hhi', 'site_age_years'],
    suggestedTreatmentVar: 'vendor_hhi',
    suggestedOutcomeVar: 'ticket_recurrence_rate',
    suggestedConfounders: ['site_age_years'],
    suggestedEstimator: 'dml',
    owningPerspective: 'vendor',
    tags: ['vendor_mix', 'recurrence'],
  },
  {
    id: 'maintenance-05',
    area: 'maintenance',
    statement:
      'Post-incident insurance-claim events have a 6-month lookback showing missed maintenance tickets in 78% of cases.',
    variables: ['insurance_claim_incident', 'missed_maintenance_lookback_6mo', 'site_age_years', 'vendor_quality_score'],
    suggestedTreatmentVar: 'missed_maintenance_lookback_6mo',
    suggestedOutcomeVar: 'insurance_claim_incident',
    suggestedConfounders: ['site_age_years', 'vendor_quality_score'],
    suggestedEstimator: 'dowhy_linear',
    owningPerspective: 'regulator',
    tags: ['safety', 'retrospective'],
  },
];
