/**
 * `@borjie/litfin-port-memory-extra` — public surface.
 *
 * LITFIN-ported memory + RAG patterns:
 *   - conversational-summary memory layer
 *   - KG entity-resolution heuristics
 *   - vector index optimizations (lazy-rebuild + delta-update)
 *   - cache-invalidation-by-fact
 *   - recall scoring (predict-then-verify)
 *
 * All modules are pure functions. Side-effects (DB / vector store /
 * LLM) are wired by callers via ports.
 */

export * from './types.js';
export * from './conversational-summary.js';
export * from './kg-entity-resolution.js';
export * from './vector-index-ops.js';
export * from './cache-invalidation-by-fact.js';
export * from './recall-scoring.js';
