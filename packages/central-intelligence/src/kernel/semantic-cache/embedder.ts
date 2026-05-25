/**
 * Semantic-cache embedder — thin wrapper around the kernel's existing
 * `EmbedderPort` (see `../embedder.ts`).
 *
 * Adds two behaviours on top of the raw embedder:
 *
 *   1. **Prompt-hash cache** — embeddings cost money (~$0.02 per 1M
 *      input tokens on text-embedding-3-small). Two consecutive calls
 *      with the same prompt should not roundtrip OpenAI twice. The
 *      cache key is a sha256 of (modelId + scopeKey + prompt) so
 *      different scopes don't share an entry — keeps the same multi-
 *      tenant guarantee as the cache store itself.
 *
 *   2. **Graceful degradation** — failures from the underlying
 *      embedder (e.g. `EmbedderNotConfigured`) collapse to `null`. The
 *      caller (kernel `think()` / `stream()`) treats a null embedding
 *      as "semantic-cache skipped this turn" and proceeds to the LLM.
 *
 * Pure construction; injectable clock for tests; the embedding cache
 * defaults to 60s TTL (the same window as the brain-cache exact path,
 * which is the upper bound on how stale an embedding for the same
 * prompt should ever be).
 */

import { createHash } from 'crypto';
import type { EmbedderPort } from '../embedder.js';
import type { SemanticCacheScope } from './cache-store.js';
import { scopeKey } from './cache-store.js';

export interface SemanticEmbedderDeps {
  /** Underlying embedder; e.g. `createOpenAiEmbedder(...)`. */
  readonly embedder: EmbedderPort;
  /** Embedding-cache TTL in ms. Default 60_000 (1 minute). */
  readonly cacheTtlMs?: number;
  /** Embedding-cache capacity. Default 1_024 entries. */
  readonly cacheCapacity?: number;
  /** Injectable clock; defaults to `Date.now`. */
  readonly clock?: () => number;
  /** Optional logger; defaults to `console.warn`. */
  readonly logger?: { warn: (msg: string) => void };
}

export interface SemanticEmbedder {
  /** Stable identifier for the embedding model (mirrors EmbedderPort.modelId). */
  readonly modelId: string;
  /** Expected vector dimensionality (mirrors EmbedderPort.dims). */
  readonly dims: number;
  /**
   * Produce an embedding for `prompt` under the given scope. Returns
   * `null` if the embedder failed (e.g. not configured / transient
   * upstream outage). Callers degrade to "no semantic cache".
   */
  embedForCache(
    scope: SemanticCacheScope,
    prompt: string,
  ): Promise<ReadonlyArray<number> | null>;
  /** Clear the embedding cache. Test / ops affordance. */
  clearCache(): void;
}

interface CacheEntry {
  readonly vector: ReadonlyArray<number>;
  readonly expiresAt: number;
}

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_CACHE_CAPACITY = 1_024;

export function createSemanticEmbedder(
  deps: SemanticEmbedderDeps,
): SemanticEmbedder {
  if (!deps.embedder) {
    throw new Error('createSemanticEmbedder: embedder is required');
  }
  const ttl = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const capacity = deps.cacheCapacity ?? DEFAULT_CACHE_CAPACITY;
  const clock = deps.clock ?? Date.now;
  const logger = deps.logger ?? { warn: (msg: string) => console.warn(msg) };
  const cache = new Map<string, CacheEntry>();

  function evictExpired(): void {
    const now = clock();
    for (const [k, e] of cache) if (e.expiresAt <= now) cache.delete(k);
  }

  function makeKey(scope: SemanticCacheScope, prompt: string): string {
    return createHash('sha256')
      .update(deps.embedder.modelId, 'utf8')
      .update('|', 'utf8')
      .update(scopeKey(scope), 'utf8')
      .update('|', 'utf8')
      .update(prompt, 'utf8')
      .digest('hex');
  }

  return {
    modelId: deps.embedder.modelId,
    dims: deps.embedder.dims,
    async embedForCache(scope, prompt) {
      if (typeof prompt !== 'string' || prompt.length === 0) return null;
      const key = makeKey(scope, prompt);
      const hit = cache.get(key);
      if (hit && hit.expiresAt > clock()) {
        // LRU touch.
        cache.delete(key);
        cache.set(key, hit);
        return hit.vector;
      }
      let vector: ReadonlyArray<number>;
      try {
        vector = await deps.embedder.embed(prompt);
      } catch (err) {
        // Degrade to no-cache — the kernel falls through to the LLM.
        logger.warn(
          `semantic-cache embedder: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      }
      if (!Array.isArray(vector) || vector.length === 0) return null;
      evictExpired();
      while (cache.size >= capacity) {
        const oldest = cache.keys().next().value as string | undefined;
        if (!oldest) break;
        cache.delete(oldest);
      }
      cache.set(key, { vector, expiresAt: clock() + ttl });
      return vector;
    },
    clearCache() {
      cache.clear();
    },
  };
}
