/**
 * Knowledge subsystem — tenant-scoped institutional knowledge + RAG.
 */
export * from './knowledge-store.js';
export * from './knowledge-indexer.js';
export * from './knowledge-retriever.js';
export * from './citations.js';
export * from './policy-packs.js';
export * from './platform-seed.js';

// Wave-13: longform HBR-quality case studies (namespaced to avoid
// symbol collisions with the shorter case snippets in policy-packs).
export * as CaseStudies from './case-studies/index.js';
