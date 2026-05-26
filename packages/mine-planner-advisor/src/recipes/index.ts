/**
 * Recipe barrel — Ms. Sifa's tab and doc recipes.
 *
 * The persona-runtime composition root reads these descriptors at boot
 * and registers them against the global tab-recipe and doc-recipe
 * catalogues with the persona id `'mining-shift-planner'` as owner.
 */

export type {
  MiningTabRecipeDescriptor,
  MiningDocRecipeDescriptor,
  RecipeBrand,
  RecipeAuthorityTier,
} from './types.js';

export { shiftPlanReviewRecipe } from './shift-plan-review.js';
export { crewAssignmentRecipe } from './crew-assignment.js';
export { weeklyProductionBriefRecipe } from './weekly-production-brief.js';
