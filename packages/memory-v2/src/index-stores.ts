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
