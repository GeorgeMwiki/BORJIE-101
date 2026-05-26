/**
 * Tab recipe — `shift_plan_review`.
 *
 * Composes a review tab for the 24-hour shift plan the Mining Shift
 * Specialist just produced. The site manager opens this tab as their
 * daily morning surface — every assignment is shown with an evidence
 * chip pointing at the polygon, equipment, and crew records it draws
 * from.
 *
 * Authority tier 1 — committing the plan stages a Tier-1 proposal
 * (write to `shift_plans`) that the site manager approves with a
 * single tap. The plan itself is not auto-applied.
 */

import type { MiningTabRecipeDescriptor } from './types.js';

export const shiftPlanReviewRecipe: MiningTabRecipeDescriptor = Object.freeze({
  id: 'shift_plan_review',
  intent: 'ShiftPlanReview',
  version: 1,
  status: 'live',
  brand: 'borjie',
  authority_tier: 1,
  data_sources: Object.freeze([
    'shift_plans',
    'plan_recommendations',
    'site_polygons',
    'assets_fleet',
    'workforce_members',
  ]) as ReadonlyArray<string>,
  telemetry_key: 'ui.recipe.shift_plan_review',
  summary:
    'Daily 24-hour shift plan review — polygon assignments, equipment, crew, and evidence chips for the site manager morning surface.',
});
