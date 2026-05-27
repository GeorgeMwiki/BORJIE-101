/**
 * `@borjie/memory-port-extensions` — extends `@borjie/persistent-memory`
 * with port shapes for external memory adapters. Public surface.
 *
 * Memory + RAG port extensions:
 *   - conversational-summary memory layer
 *   - KG entity-resolution heuristics
 *   - vector index optimizations (lazy-rebuild + delta-update)
 *   - cache-invalidation-by-fact
 *   - recall scoring (predict-then-verify)
 *
 * All modules are pure functions. Side-effects (DB / vector store /
 * LLM) are wired by callers via ports.
 *
 * Structure inherited from a pre-fork lineage; evolved independently
 * as part of Borjie.
 */

export * from './types.js';
export * from './conversational-summary.js';
export * from './kg-entity-resolution.js';
export * from './vector-index-ops.js';
export * from './cache-invalidation-by-fact.js';
export * from './recall-scoring.js';
