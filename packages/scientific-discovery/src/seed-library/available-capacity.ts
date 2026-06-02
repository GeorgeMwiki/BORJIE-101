/**
 * Available-capacity-driver hypotheses — 5 seeds.
 *
 * Mining-estate analogue of the LITFIN vacancy seeds: what drives a
 * mining unit / sub-tenement to sit idle (un-contracted spare
 * capacity) rather than being in production under an active offtake.
 */

import type { HypothesisSeed } from '../types.js';

export const AVAILABLE_CAPACITY_SEEDS: readonly HypothesisSeed[] = [
  {
    id: 'available_capacity-01',
    area: 'available_capacity',
    statement:
      'District-level idle capacity diverges from regional average because of new comparable supply, with a 6-month lag.',
    variables: ['unit_months_idle', 'nearby_new_concession_count', 'unit_grade', 'price_vs_market'],
    suggestedTreatmentVar: 'nearby_new_concession_count',
    suggestedOutcomeVar: 'unit_months_idle',
    suggestedConfounders: ['unit_grade', 'price_vs_market'],
    suggestedEstimator: 'causal_forest',
    owningPerspective: 'underwriter',
    tags: ['supply_shock', 'district', 'lagged'],
  },
  {
    id: 'available_capacity-02',
    area: 'available_capacity',
    statement:
      'Sites within 50km of a new haul road or rail spur see offtake price uplift of 4–9% within 12 months.',
    variables: ['price_per_tonne', 'distance_to_haul_road_km', 'unit_capacity_tpd', 'site_age_years'],
    suggestedTreatmentVar: 'distance_to_haul_road_km',
    suggestedOutcomeVar: 'price_per_tonne',
    suggestedConfounders: ['unit_capacity_tpd', 'site_age_years'],
    suggestedEstimator: 'causalpy_its',
    owningPerspective: 'underwriter',
    jurisdictions: ['KE', 'TZ', 'UG'],
    tags: ['logistics', 'infrastructure_proximity'],
  },
  {
    id: 'available_capacity-03',
    area: 'available_capacity',
    statement:
      'Units with more than 3 plant-outage tickets per month see throughput drop and an idle-capacity spike 60 days later.',
    variables: ['idle_capacity_60d_later', 'plant_outage_ticket_rate', 'season', 'area_code'],
    suggestedTreatmentVar: 'plant_outage_ticket_rate',
    suggestedOutcomeVar: 'idle_capacity_60d_later',
    suggestedConfounders: ['season', 'area_code'],
    suggestedEstimator: 'pcmciplus',
    owningPerspective: 'site_supervisor',
    tags: ['plant_reliability', 'lagged'],
  },
  {
    id: 'available_capacity-04',
    area: 'available_capacity',
    statement:
      'Units listed simultaneously on more than 2 offtake marketplaces are contracted 11 days faster than single-channel listings.',
    variables: ['days_to_contract', 'marketplace_count', 'offtake_price', 'unit_type'],
    suggestedTreatmentVar: 'marketplace_count',
    suggestedOutcomeVar: 'days_to_contract',
    suggestedConfounders: ['offtake_price', 'unit_type'],
    suggestedEstimator: 'dml',
    owningPerspective: 'owner',
    tags: ['distribution', 'listing_strategy'],
  },
  {
    id: 'available_capacity-05',
    area: 'available_capacity',
    statement:
      'Diaspora-owned units have 11% longer idle capacity after first turnover due to slow approval loops.',
    variables: ['idle_duration_days', 'owner_diaspora_binary', 'offtake_price', 'area_code'],
    suggestedTreatmentVar: 'owner_diaspora_binary',
    suggestedOutcomeVar: 'idle_duration_days',
    suggestedConfounders: ['offtake_price', 'area_code'],
    suggestedEstimator: 'dml',
    owningPerspective: 'diaspora_investor',
    tags: ['governance', 'approval_latency'],
  },
];
