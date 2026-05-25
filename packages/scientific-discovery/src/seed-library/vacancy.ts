/**
 * Vacancy-driver hypotheses — 5 seeds.
 *
 * Mirrors entries 1, 8, 12, 18, 25 from §10 of
 * `.audit/litfin-sota-2026-05-23/13-scientific-discovery.md`.
 */

import type { HypothesisSeed } from '../types.js';

export const VACANCY_SEEDS: readonly HypothesisSeed[] = [
  {
    id: 'vacancy-01',
    area: 'vacancy',
    statement:
      'District-level vacancy diverges from city average because of new comparable supply, with a 6-month lag.',
    variables: ['unit_months_vacant', 'nearby_new_build_count', 'unit_quality', 'rent_vs_market'],
    suggestedTreatmentVar: 'nearby_new_build_count',
    suggestedOutcomeVar: 'unit_months_vacant',
    suggestedConfounders: ['unit_quality', 'rent_vs_market'],
    suggestedEstimator: 'causal_forest',
    owningPerspective: 'underwriter',
    tags: ['supply_shock', 'district', 'lagged'],
  },
  {
    id: 'vacancy-02',
    area: 'vacancy',
    statement:
      'Properties within 800m of a new BRT (bus rapid transit) stop see rent uplift of 4–9% within 12 months.',
    variables: ['rent_per_sqm', 'distance_to_brt_m', 'unit_size_sqm', 'building_age_years'],
    suggestedTreatmentVar: 'distance_to_brt_m',
    suggestedOutcomeVar: 'rent_per_sqm',
    suggestedConfounders: ['unit_size_sqm', 'building_age_years'],
    suggestedEstimator: 'causalpy_its',
    owningPerspective: 'underwriter',
    jurisdictions: ['KE', 'TZ', 'UG'],
    tags: ['transit', 'amenity_proximity'],
  },
  {
    id: 'vacancy-03',
    area: 'vacancy',
    statement:
      'Properties with more than 3 utility-outage tickets per month see satisfaction drop and a vacancy spike 60 days later.',
    variables: ['vacancy_60d_later', 'utility_ticket_rate', 'season', 'area_code'],
    suggestedTreatmentVar: 'utility_ticket_rate',
    suggestedOutcomeVar: 'vacancy_60d_later',
    suggestedConfounders: ['season', 'area_code'],
    suggestedEstimator: 'pcmciplus',
    owningPerspective: 'caretaker',
    tags: ['service_quality', 'lagged'],
  },
  {
    id: 'vacancy-04',
    area: 'vacancy',
    statement:
      'Properties listed simultaneously on more than 2 portals fill 11 days faster than single-portal listings.',
    variables: ['days_to_fill', 'portal_count', 'rent_amount', 'unit_type'],
    suggestedTreatmentVar: 'portal_count',
    suggestedOutcomeVar: 'days_to_fill',
    suggestedConfounders: ['rent_amount', 'unit_type'],
    suggestedEstimator: 'dml',
    owningPerspective: 'owner',
    tags: ['distribution', 'listing_strategy'],
  },
  {
    id: 'vacancy-05',
    area: 'vacancy',
    statement:
      'Diaspora-owned units have 11% longer vacancy after first turnover due to slow approval loops.',
    variables: ['vacancy_duration_days', 'owner_diaspora_binary', 'rent_amount', 'area_code'],
    suggestedTreatmentVar: 'owner_diaspora_binary',
    suggestedOutcomeVar: 'vacancy_duration_days',
    suggestedConfounders: ['rent_amount', 'area_code'],
    suggestedEstimator: 'dml',
    owningPerspective: 'diaspora_investor',
    tags: ['governance', 'approval_latency'],
  },
];
