/**
 * Semantic Cache Store — Phase D D4 (LLM Cost Reduction).
 *
 * Embedding-keyed cache that supplements the brain-side LRU cache
 * (`../brain-cache.ts`). The brain-cache de-duplicates ENTIRE thoughts
 * across sessions on an exact (scope + persona + tier + message hash)
 * key — it's fast but brittle. The semantic-cache is a slower, smarter
 * layer underneath: it stores BrainDecision values keyed by the
 * embedding vector of the prompt, and returns a hit when an incoming
 * prompt's embedding falls within `threshold` cosine-similarity of an
 * existing entry.
 *
 * Why two layers:
 *   - brain-cache hit  → ~0ms, zero embedding cost
 *   - semantic hit     → one embedding call (~100ms, ~$0.00002 with
 *                        text-embedding-3-small @ $0.02/M tokens), but
 *                        catches "what's the rent?" vs "tell me the
 *                        rent figure" as the same intent.
 *   - miss             → falls through to the LLM
 *
 * Scope keying: every entry is namespaced under
 *   `(tenantId | __platform__, surface, personaId)`.
 * Cross-tenant matches are NEVER possible — the store keeps a separate
 * sub-map per scope and the public `get(scope, …)` API is the only
 * read path.
 *
 * Eviction: LRU per scope, default capacity 10_000 entries. The
 * oldest-inserted entry is evicted when capacity is exceeded. `set()`
 * with an already-present `cacheId` refreshes the touch-order.
 *
 * TTL: per-entry; expired entries return a miss and are removed lazily
 * during `get()`. A `ttlMs <= 0` is treated as "do not store".
 *
 * Adapters: the file ships an in-memory adapter (`createInMemoryCacheStore`)
 * and a deferred Redis adapter (`createRedisCacheStore`). The Redis
 * adapter is a thin port — it requires the caller to supply a Redis
 * client because the central-intelligence package does not bundle
 * `ioredis` and we want the kernel to boot with zero external deps.
 * The Redis adapter is wired-but-inert when no client is supplied: it
 * falls back to the in-memory store and logs a single WARN.
 *
 * Pure data structure with an injectable clock; no IO beyond the
 * optional Redis adapter, which is itself behind a port.
 */

import type { BrainDecision } from '../kernel-types.js';

// ─────────────────────────────────────────────────────────────────────
// Scope key
// ─────────────────────────────────────────────────────────────────────

/**
 * Scope key for namespacing cache entries. Cross-tenant matches must
 * never happen, so the tenantId is part of the key. The surface and
 * personaId capture the rendering context — a Swahili tenant-resident
 * surface and a sovereign-admin HQ surface produce different
 * BrainDecisions for the same userMessage.
 */
export interface SemanticCacheScope {
  /** Null only for platform-tier scopes (no tenant). */
  readonly tenantId: string | null;
  /** e.g. 'tenant-portal', 'manager-portal', 'sovereign-cockpit'. */
  readonly surface: string;
  /** Persona identifier (typed loosely so the cache stays decoupled). */
  readonly personaId: string;
}

/**
 * Stable string key for a scope. Used internally to partition the
 * embedding store into per-scope sub-maps.
 */
export function scopeKey(scope: SemanticCacheScope): string {
  const tenantPart = scope.tenantId ?? '__platform__';
  return `${tenantPart}|${scope.surface}|${scope.personaId}`;
}

// ─────────────────────────────────────────────────────────────────────
// Public port + types
// ─────────────────────────────────────────────────────────────────────

export interface SemanticCacheEntry {
  /** Stable identifier; used by callers to forward-reference the row. */
  readonly cacheId: string;
  /** Pre-normalised embedding vector (length must match across a scope). */
  readonly embedding: ReadonlyArray<number>;
  /** Cached BrainDecision payload (returned as-is on hit). */
  readonly value: BrainDecision;
  /** ms-since-epoch wall-clock at which the entry expires. */
  readonly expiresAt: number;
  /** ms-since-epoch wall-clock at which the entry was first inserted. */
  readonly insertedAt: number;
}

export interface SemanticCacheHit {
  readonly entry: SemanticCacheEntry;
  /** Cosine similarity score in [-1, 1] (typically ≥ threshold). */
  readonly similarity: number;
}

export interface SemanticCacheSetArgs {
  readonly cacheId: string;
  readonly embedding: ReadonlyArray<number>;
  readonly value: BrainDecision;
  /** ms; pass `<= 0` to suppress storage (e.g. command intent). */
  readonly ttlMs: number;
}

export interface SemanticCacheStore {
  /**
   * Find the nearest entry within `threshold` cosine similarity.
   * Returns `null` on miss, expired-only matches, or empty scope.
   * Pure read — does NOT mutate touch-order on miss; on hit, the
   * entry is LRU-refreshed so subsequent reads stay fresh.
   */
  get(
    scope: SemanticCacheScope,
    embedding: ReadonlyArray<number>,
    threshold: number,
  ): Promise<SemanticCacheHit | null>;

  /** Insert (or refresh) an entry. ttlMs ≤ 0 is a no-op. */
  set(scope: SemanticCacheScope, args: SemanticCacheSetArgs): Promise<void>;

  /** Drop every entry under a scope. */
  clear(scope: SemanticCacheScope): Promise<void>;

  /** Drop every entry across every scope. Test / ops affordance. */
  clearAll(): Promise<void>;

  /** Per-scope entry count (post-eviction). */
  size(scope: SemanticCacheScope): Promise<number>;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory adapter
// ─────────────────────────────────────────────────────────────────────

export interface InMemoryCacheStoreDeps {
  /** Per-scope LRU capacity. Default 10_000. */
  readonly capacityPerScope?: number;
  /** Injectable clock; defaults to `Date.now`. */
  readonly clock?: () => number;
}

const DEFAULT_CAPACITY_PER_SCOPE = 10_000;

export function createInMemoryCacheStore(
  deps: InMemoryCacheStoreDeps = {},
): SemanticCacheStore {
  const capacity = deps.capacityPerScope ?? DEFAULT_CAPACITY_PER_SCOPE;
  const clock = deps.clock ?? Date.now;
  // Map<scopeKey, Map<cacheId, SemanticCacheEntry>>. The inner Map is
  // insertion-ordered so iteration yields oldest-first — exactly what
  // we need for LRU eviction.
  const buckets = new Map<string, Map<string, SemanticCacheEntry>>();

  function bucketFor(scope: SemanticCacheScope): Map<string, SemanticCacheEntry> {
    const key = scopeKey(scope);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = new Map<string, SemanticCacheEntry>();
      buckets.set(key, bucket);
    }
    return bucket;
  }

  function evictExpired(bucket: Map<string, SemanticCacheEntry>): void {
    const now = clock();
    for (const [id, entry] of bucket) {
      if (entry.expiresAt <= now) bucket.delete(id);
    }
  }

  function evictOldestUntilUnderCap(
    bucket: Map<string, SemanticCacheEntry>,
  ): void {
    while (bucket.size > capacity) {
      const oldest = bucket.keys().next().value as string | undefined;
      if (!oldest) break;
      bucket.delete(oldest);
    }
  }

  return {
    async get(scope, embedding, threshold) {
      const bucket = bucketFor(scope);
      if (bucket.size === 0) return null;
      evictExpired(bucket);
      let best: { entry: SemanticCacheEntry; similarity: number } | null = null;
      for (const entry of bucket.values()) {
        if (entry.embedding.length !== embedding.length) continue;
        const sim = cosineSimilarity(entry.embedding, embedding);
        if (sim < threshold) continue;
        if (!best || sim > best.similarity) {
          best = { entry, similarity: sim };
        }
      }
      if (!best) return null;
      // LRU touch — re-insert at tail.
      bucket.delete(best.entry.cacheId);
      bucket.set(best.entry.cacheId, best.entry);
      return best;
    },
    async set(scope, args) {
      if (args.ttlMs <= 0) return;
      const bucket = bucketFor(scope);
      const now = clock();
      // Refresh-on-write — delete first so the new insert lands at tail.
      if (bucket.has(args.cacheId)) bucket.delete(args.cacheId);
      bucket.set(args.cacheId, {
        cacheId: args.cacheId,
        embedding: args.embedding,
        value: args.value,
        expiresAt: now + args.ttlMs,
        insertedAt: now,
      });
      evictExpired(bucket);
      evictOldestUntilUnderCap(bucket);
    },
    async clear(scope) {
      buckets.delete(scopeKey(scope));
    },
    async clearAll() {
      buckets.clear();
    },
    async size(scope) {
      const bucket = buckets.get(scopeKey(scope));
      if (!bucket) return 0;
      evictExpired(bucket);
      return bucket.size;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Cosine similarity
// ─────────────────────────────────────────────────────────────────────

/**
 * Cosine similarity of two equal-length vectors. Returns 0 for any
 * malformed input (empty vector, length mismatch, zero-norm) so the
 * cache always degrades to a miss rather than throwing.
 */
export function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─────────────────────────────────────────────────────────────────────
// Redis adapter (deferred — port + lazy fallback)
// ─────────────────────────────────────────────────────────────────────

/**
 * Minimal Redis surface the semantic-cache exercises. Matches the
 * `ioredis` API by name but is intentionally narrow — the kernel
 * package must not depend on the ioredis runtime, so the operator
 * injects a real client at composition time.
 */
export interface SemanticCacheRedisLike {
  hset(key: string, field: string, value: string): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  del(...keys: string[]): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
}

export interface RedisCacheStoreDeps {
  /** Optional Redis client. When omitted, the store falls back to in-memory. */
  readonly redis?: SemanticCacheRedisLike | null;
  /** Optional key prefix; defaults to `bnyumba:semcache`. */
  readonly keyPrefix?: string;
  /** Forwarded to the in-memory fallback. */
  readonly capacityPerScope?: number;
  /** Injectable clock; defaults to `Date.now`. */
  readonly clock?: () => number;
  /** Optional logger; defaults to `console.warn`. */
  readonly logger?: { warn: (msg: string) => void };
}

/**
 * Redis-backed adapter — currently a thin wrapper that delegates to the
 * in-memory store while the operational story for keying cross-process
 * embedding search is finalised. The signature is stable so callers can
 * already wire the deps; the on-the-wire schema lands in a follow-up.
 *
 * When `deps.redis` is null/undefined, the store transparently
 * degrades to the in-memory adapter and emits a single WARN line so
 * operators notice the unconfigured Redis URL.
 */
export function createRedisCacheStore(
  deps: RedisCacheStoreDeps = {},
): SemanticCacheStore {
  const logger = deps.logger ?? { warn: (msg) => console.warn(msg) };
  if (!deps.redis) {
    logger.warn(
      'semantic-cache: Redis client not provided — falling back to in-memory store',
    );
    const memDeps: InMemoryCacheStoreDeps = {};
    if (deps.capacityPerScope !== undefined) {
      (memDeps as { capacityPerScope: number }).capacityPerScope =
        deps.capacityPerScope;
    }
    if (deps.clock !== undefined) {
      (memDeps as { clock: () => number }).clock = deps.clock;
    }
    return createInMemoryCacheStore(memDeps);
  }
  // The on-the-wire schema (binary-packed embeddings vs JSON, partition
  // strategy, scan vs. RediSearch vector index) is left to the operator
  // who owns the Redis cluster. The port is stable so the adapter can
  // be swapped in without changing any caller.
  const fallback: InMemoryCacheStoreDeps = {};
  if (deps.capacityPerScope !== undefined) {
    (fallback as { capacityPerScope: number }).capacityPerScope =
      deps.capacityPerScope;
  }
  if (deps.clock !== undefined) {
    (fallback as { clock: () => number }).clock = deps.clock;
  }
  logger.warn(
    'semantic-cache: Redis adapter wired but using in-memory delegate (vector-search schema deferred)',
  );
  return createInMemoryCacheStore(fallback);
}
