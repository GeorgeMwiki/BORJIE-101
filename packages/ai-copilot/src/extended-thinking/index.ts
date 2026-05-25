/**
 * Extended-thinking barrel — Wave 28 Agent THINK.
 *
 * Public surface for stake-aware thinking-budget allocation. Services
 * wrap their high-stakes calls with `createThinkingRouter(...)` so
 * terminations / evictions / tribunal filings trigger deliberate
 * inner-loop deliberation while routine reminders stay fast and cheap.
 */

export * from './types.js';
export {
  classifyStakes,
  getDomainThresholds,
} from './decision-stakes-classifier.js';
export {
  HIGH_STAKES_CATALOGUE,
  HIGH_STAKES_CATALOGUE_COUNT,
  classifyByActionName,
  requireCatalogueEntry,
  listCatalogueEntries,
  type HighStakesCatalogueEntry,
} from './high-stakes-catalogue.js';
export {
  createThinkingRouter,
  fallbackFromDecider,
} from './thinking-router.js';
