/**
 * Self-Discover — barrel.
 *
 * Surface:
 *   - discoverReasoningStructure(...)
 *   - createInMemoryReasoningStructureCache()
 *   - the 39+6 primitive library
 *   - SELECT / ADAPT / IMPLEMENT meta-prompt builders
 *   - seed structures (eviction TZ-DSM, tenant-dispute GLOBAL)
 *   - all types
 */

export * from './types.js';
export {
  ALL_PRIMITIVES,
  UNIVERSAL_PRIMITIVES,
  BORJIE_PRIMITIVES,
  findPrimitiveById,
  primitiveCounts,
  type ReasoningPrimitive,
  type ReasoningPrimitiveDomain,
} from './module-library.js';
export {
  buildSelectPrompt,
  buildAdaptPrompt,
  buildImplementPrompt,
} from './meta-prompts.js';
export {
  discoverReasoningStructure,
  ReasoningStructureValidationError,
  type DiscoverArgs,
  type DiscoverResult,
} from './discover.js';
export { createInMemoryReasoningStructureCache } from './in-memory-cache.js';
export {
  EVICTION_TZ_DSM_STRUCTURE,
  TENANT_DISPUTE_GLOBAL_STRUCTURE,
  SEED_STRUCTURES,
} from './canonical-structures.js';
