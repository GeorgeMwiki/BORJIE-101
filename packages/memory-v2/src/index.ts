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

// MEM-01 — durable Drizzle stores + the shared store logger contract.
export {
  createDrizzleEpisodicStore,
  createDrizzleNarrativeStore,
  createDrizzleProceduralStore,
  createDrizzleReflectiveStore,
  createDrizzleTopicFileStore,
  createDrizzleCohortCacheStore,
} from './index-stores.js';
export {
  type DrizzleStoreLogger,
  NOOP_STORE_LOGGER,
} from './drizzle-logger.js';

import {
  createDrizzleCohortCacheStore,
  createDrizzleEpisodicStore,
  createDrizzleNarrativeStore,
  createDrizzleProceduralStore,
  createDrizzleReflectiveStore,
  createDrizzleTopicFileStore,
  createInMemoryCohortCacheStore,
  createInMemoryEpisodicStore,
  createInMemoryNarrativeStore,
  createInMemoryProceduralStore,
  createInMemoryReflectiveStore,
  createInMemoryTopicFileStore,
} from './index-stores.js';
import type { DrizzleStoreLogger } from './drizzle-logger.js';
import type { DatabaseClient } from '@borjie/database';
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

/**
 * MEM-01 — build a fully **durable** MemoryV2 backed by the Drizzle stores
 * (migration 0312). Use this at the composition root when a live DB handle is
 * present so the six-layer substrate survives a process restart. Each store
 * implements the identical port as its in-memory counterpart, so swapping
 * `createInMemoryMemoryV2` → `createDrizzleMemoryV2` requires no other change.
 *
 * Caller may override individual stores (e.g. keep `cohort` in-memory while the
 * other five persist) and may inject a Pino-backed structural logger for
 * non-fatal store diagnostics.
 */
export function createDrizzleMemoryV2(
  db: DatabaseClient,
  options: {
    readonly overrides?: Partial<MemoryV2Stores>;
    readonly logger?: DrizzleStoreLogger;
  } & Pick<MemoryV2Options, 'embedder' | 'brain'> = {},
): MemoryV2 {
  const overrides = options.overrides ?? {};
  const logger = options.logger;
  const stores: MemoryV2Stores = {
    episodic: overrides.episodic ?? createDrizzleEpisodicStore(db, logger),
    narrative: overrides.narrative ?? createDrizzleNarrativeStore(db, logger),
    procedural: overrides.procedural ?? createDrizzleProceduralStore(db, logger),
    reflective: overrides.reflective ?? createDrizzleReflectiveStore(db, logger),
    topics: overrides.topics ?? createDrizzleTopicFileStore(db, logger),
    cohort: overrides.cohort ?? createDrizzleCohortCacheStore(db, logger),
  };
  const composeOpts: {
    -readonly [K in keyof Pick<MemoryV2Options, 'embedder' | 'brain'>]: Pick<
      MemoryV2Options,
      'embedder' | 'brain'
    >[K];
  } = {};
  if (options.embedder !== undefined) composeOpts.embedder = options.embedder;
  if (options.brain !== undefined) composeOpts.brain = options.brain;
  return createMemoryV2({ stores, ...composeOpts });
}
