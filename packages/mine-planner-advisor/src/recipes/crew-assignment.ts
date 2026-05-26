/**
 * Tab recipe — `crew_assignment`.
 *
 * Composes the crew-assignment editor — the site manager picks crew
 * members per shift, sees Ms. Sifa's skill-match recommendations, and
 * commits to the roster. Used both at the start of a shift and when a
 * crew change happens mid-shift.
 *
 * Authority tier 1 — assignment changes stage a Tier-1 proposal
 * touching `workforce_members.shift_availability` joins and the
 * `shift_plans.assignments[*].crew_ids` array.
 */

import type { MiningTabRecipeDescriptor } from './types.js';

export const crewAssignmentRecipe: MiningTabRecipeDescriptor = Object.freeze({
  id: 'crew_assignment',
  intent: 'CrewAssignment',
  version: 1,
  status: 'live',
  brand: 'borjie',
  authority_tier: 1,
  data_sources: Object.freeze([
    'workforce_members',
    'shift_plans',
    'assets_fleet',
  ]) as ReadonlyArray<string>,
  telemetry_key: 'ui.recipe.crew_assignment',
  summary:
    'Crew assignment editor — skill-match recommendations, shift availability, and roster commit for each polygon-equipment pair.',
});
