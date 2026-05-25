/**
 * `@borjie/memory-v2` — public surface.
 *
 * Composition root: `createMemoryV2({ stores, embedder?, brain? })`
 * Ships in-memory adapters for every store. Wire production adapters
 * (Postgres/pgvector, Redis, Drizzle) at the app's composition root.
 */

// Types
export * from './types.js';

// Episodic
export { createInMemoryEpisodicStore } from './episodic/index.js';

// Narrative
export {
  buildNarrativeArcs,
  createInMemoryNarrativeStore,
} from './narrative/index.js';

// Procedural
export {
  createInMemoryProceduralStore,
  PROCEDURAL_PROMOTION_THRESHOLD,
} from './procedural/index.js';

// Reflective
export { createInMemoryReflectiveStore, reflect } from './reflective/index.js';

// Topic files
export { createInMemoryTopicFileStore } from './topic-files/index.js';

// Cohort cache
export { createInMemoryCohortCacheStore } from './cohort-cache/index.js';

import {
  createInMemoryCohortCacheStore,
  createInMemoryEpisodicStore,
  createInMemoryNarrativeStore,
  createInMemoryProceduralStore,
  createInMemoryReflectiveStore,
  createInMemoryTopicFileStore,
} from './index-stores.js';
import type { MemoryV2, MemoryV2Options, MemoryV2Stores } from './types.js';

/**
 * Compose the unified MemoryV2 API. Pass the stores explicitly (any
 * combination of in-memory + production adapters). Embedder + brain are
 * optional; pass `null` to disable embedding / reflection respectively.
 */
export function createMemoryV2(options: MemoryV2Options): MemoryV2 {
  return {
    stores: options.stores,
    embedder: options.embedder ?? null,
    brain: options.brain ?? null,
  };
}

/**
 * Convenience: build a fully in-memory MemoryV2 (useful for tests +
 * local development). Caller may override individual stores.
 */
export function createInMemoryMemoryV2(
  overrides: Partial<MemoryV2Stores> = {},
  opts: Pick<MemoryV2Options, 'embedder' | 'brain'> = {},
): MemoryV2 {
  const stores: MemoryV2Stores = {
    episodic: overrides.episodic ?? createInMemoryEpisodicStore(),
    narrative: overrides.narrative ?? createInMemoryNarrativeStore(),
    procedural: overrides.procedural ?? createInMemoryProceduralStore(),
    reflective: overrides.reflective ?? createInMemoryReflectiveStore(),
    topics: overrides.topics ?? createInMemoryTopicFileStore(),
    cohort: overrides.cohort ?? createInMemoryCohortCacheStore(),
  };
  return createMemoryV2({ stores, ...opts });
}
