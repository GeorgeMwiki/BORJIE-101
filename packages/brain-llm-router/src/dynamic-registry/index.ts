/**
 * `@borjie/brain-llm-router/dynamic-registry` — public surface.
 *
 * See `./resolver.ts` for the architecture diagram and contract.
 */

export {
  MODELS,
  MODEL_FAMILIES,
  isModelFamily,
  type ModelFamily,
  FAMILY_CAPABILITY_RANK,
  capabilityRankOf,
  rankedAnthropicFamilies,
  tierFamilyByCapability,
  type ReasoningTier,
} from './baselines.js';
export {
  getModelLatest,
  warmAllFamilies,
  scheduleRefresh,
  __resetInflight,
} from './resolver.js';
export { cache } from './cache.js';
export {
  setFetchPort,
  clearFetchPort,
  type DynamicRegistryFetchPort,
  type DynamicRegistryFetchOptions,
  type DynamicRegistryFetchResult,
} from './fetch-port.js';
export {
  setLogger,
  clearLogger,
  type ResolverLogger,
} from './logger-port.js';
export {
  fetchLatestForFamily,
  FAMILY_PATTERNS,
  extractIds,
} from './fetchers.js';
export {
  validateModel,
  type ValidateOutcome,
  type ValidateResult,
} from './validate-model.js';
export { compareModelIds, pickNewest } from './version-compare.js';
