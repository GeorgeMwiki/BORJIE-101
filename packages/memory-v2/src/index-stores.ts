/**
 * Internal aggregator — re-exports the in-memory store factories so
 * `createInMemoryMemoryV2` can compose them without re-importing each.
 */

export { createInMemoryEpisodicStore } from './episodic/store-inmemory.js';
export { createInMemoryNarrativeStore } from './narrative/store-inmemory.js';
export { createInMemoryProceduralStore } from './procedural/store-inmemory.js';
export { createInMemoryReflectiveStore } from './reflective/store-inmemory.js';
export { createInMemoryTopicFileStore } from './topic-files/store-inmemory.js';
export { createInMemoryCohortCacheStore } from './cohort-cache/store-inmemory.js';

// MEM-01 — durable Drizzle counterparts. Selected at the composition root
// when a live DB handle is present so the six-layer substrate survives a
// process restart. Each implements the identical store port.
export { createDrizzleEpisodicStore } from './episodic/store-drizzle.js';
export { createDrizzleNarrativeStore } from './narrative/store-drizzle.js';
export { createDrizzleProceduralStore } from './procedural/store-drizzle.js';
export { createDrizzleReflectiveStore } from './reflective/store-drizzle.js';
export { createDrizzleTopicFileStore } from './topic-files/store-drizzle.js';
export { createDrizzleCohortCacheStore } from './cohort-cache/store-drizzle.js';
