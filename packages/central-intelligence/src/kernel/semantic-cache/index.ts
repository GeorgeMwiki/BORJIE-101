/**
 * Semantic cache — Phase D D4 public surface.
 *
 * The exact-key brain-cache (`../brain-cache.ts`) is the fast path
 * (~0ms hits). This module is the slower, smarter underlay: embedding-
 * keyed lookups with cosine-similarity matching that catches "what's
 * the rent?" vs "tell me the rent figure" as the same intent.
 *
 * Cross-tenant isolation: every entry is namespaced under
 * `(tenantId, surface, personaId)`. Tenant A's cache CANNOT match
 * Tenant B's prompt.
 *
 * Pairs with the Anthropic prompt-prefix-cache layer in
 * `@borjie/ai-copilot/providers/anthropic-prefix-cache.ts`. Both
 * patterns together target a 60-90% LLM cost reduction.
 */

export {
  createSemanticCache,
  createCostRateRegistry,
  computeCostUsdMicros,
  SEMANTIC_CACHE_TTL_MS_BY_INTENT,
  DEFAULT_SIMILARITY_THRESHOLD,
  SONNET_4_6_RATE,
  OPUS_4_6_RATE,
  HAIKU_4_5_RATE,
  type SemanticCache,
  type SemanticCacheDeps,
  type SemanticCacheLookupArgs,
  type SemanticCacheLookupResult,
  type SemanticCacheStoreArgs,
  type SemanticCacheTelemetryEvent,
  type SemanticCacheTelemetrySink,
  type CostRateRegistry,
  type ModelCostRate,
} from './semantic-cache.js';

export {
  createInMemoryCacheStore,
  createRedisCacheStore,
  cosineSimilarity,
  scopeKey,
  type SemanticCacheStore,
  type SemanticCacheScope,
  type SemanticCacheEntry,
  type SemanticCacheHit,
  type SemanticCacheSetArgs,
  type SemanticCacheRedisLike,
  type RedisCacheStoreDeps,
  type InMemoryCacheStoreDeps,
} from './cache-store.js';

export {
  createSemanticEmbedder,
  type SemanticEmbedder,
  type SemanticEmbedderDeps,
} from './embedder.js';
