/**
 * Doc recipe — `weekly_production_brief`.
 *
 * Composes the weekly production brief — a PDF/DOCX/MD summary of the
 * past week's shift plans vs. actuals, broken down by polygon and by
 * equipment, with evidence anchors for every figure.
 *
 * Owner gate: approval — the brief is durable and gets filed with the
 * site's monthly production record, so the site manager must approve
 * before distribution.
 */

import type { MiningDocRecipeDescriptor } from './types.js';

export const weeklyProductionBriefRecipe: MiningDocRecipeDescriptor =
  Object.freeze({
    id: 'weekly_production_brief',
    version: 1,
    status: 'live',
    brand: 'borjie',
    outputs: Object.freeze([
      'pdf',
      'docx',
      'md',
    ]) as ReadonlyArray<'pdf' | 'docx' | 'md'>,
    data_sources: Object.freeze([
      'shift_plans',
      'plan_recommendations',
      'site_polygons',
      'assets_fleet',
    ]) as ReadonlyArray<string>,
    telemetry_key: 'doc.recipe.weekly_production_brief',
    owner_gate: 'approval',
    summary:
      'Weekly production brief — plan vs. actual roll-up by polygon and by equipment, with span-cited figures for every tonnage and opex number.',
  });
