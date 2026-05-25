/**
 * Bundle-budget barrel — runtime check + CLI entry + presets.
 */

export {
  APP_BUDGETS,
  checkBundleBudget,
  checkAllBudgets,
  parseStatsToSizes,
} from './check-bundle-budget.js';
export type { BundleSizeMap, RollupLikeStats } from './check-bundle-budget.js';
