/**
 * `@borjie/brain-llm-router/kv-cache` (LP-12) — SCAFFOLD surface.
 *
 * Prompt-cache prefix registry: dedup a shared provider cache id across sibling
 * requests with the same system prompt. Typed interface + minimal in-memory LRU;
 * cross-replica telemetry + TTL wiring are TODO(LP-12).
 */

export {
  KvPrefixRegistry,
  prefixKey,
  isKvCacheHotSwapEnabled,
  type PrefixCacheEntry,
  type PrefixLookupArgs,
  type PrefixAssignArgs,
  type PrefixHitOrMiss,
  type PrefixRegistryStats,
} from './prefix-registry.js';
