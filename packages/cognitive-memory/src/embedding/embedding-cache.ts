/**
 * Embedding cache (Wave 18W).
 *
 * 30-day TTL keyed on canonicalised text. Identical re-observations
 * hit the cache and skip the OpenAI embedding call entirely.
 *
 * The cache is intentionally in-process + bounded. Hosts can swap the
 * `CachePort` with a Redis-backed implementation for cross-process
 * sharing. Cost target: ≤$0.10 per 1000 observe calls (text-embedding-
 * 3-large is ~$0.13/1M tokens; an average cell is ~100 tokens, so even
 * with zero cache the cost is well within budget — cache shaves the
 * common-case re-observation to ~$0).
 */

const DEFAULT_TTL_MS: number = 30 * 24 * 60 * 60 * 1000;

export interface CachePort {
  get(key: string): ReadonlyArray<number> | null;
  set(key: string, value: ReadonlyArray<number>, expires_at_ms: number): void;
}

export interface EmbeddingCacheOptions {
  readonly ttl_ms?: number;
  readonly now?: () => number;
  readonly store?: CachePort;
  readonly max_entries?: number;
}

interface CacheEntry {
  readonly value: ReadonlyArray<number>;
  readonly expires_at_ms: number;
}

/**
 * Canonicalise free text so trivial whitespace/casing differences hit
 * the same cache slot. Trims, collapses whitespace, lowercases. Doing
 * a more sophisticated normalisation (stemming, NFKC) would over-merge
 * — keep it minimal.
 */
export function canonicalizeForCache(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

class InMemoryCache implements CachePort {
  private readonly entries: Map<string, CacheEntry> = new Map();
  private readonly max_entries: number;
  private readonly now: () => number;

  public constructor(max_entries: number, now: () => number) {
    this.max_entries = max_entries;
    this.now = now;
  }

  public get(key: string): ReadonlyArray<number> | null {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return null;
    }
    if (entry.expires_at_ms <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  public set(key: string, value: ReadonlyArray<number>, expires_at_ms: number): void {
    if (this.entries.size >= this.max_entries && !this.entries.has(key)) {
      // simplest eviction: drop the oldest insertion order
      const oldest_key = this.entries.keys().next().value;
      if (oldest_key !== undefined) {
        this.entries.delete(oldest_key);
      }
    }
    this.entries.set(key, { value, expires_at_ms });
  }
}

export interface EmbeddingCache {
  readonly ttl_ms: number;
  lookup(text: string): ReadonlyArray<number> | null;
  remember(text: string, embedding: ReadonlyArray<number>): void;
}

export function createEmbeddingCache(options: EmbeddingCacheOptions = {}): EmbeddingCache {
  const ttl_ms: number = options.ttl_ms ?? DEFAULT_TTL_MS;
  const now: () => number = options.now ?? ((): number => Date.now());
  const max_entries: number = options.max_entries ?? 10_000;
  const store: CachePort = options.store ?? new InMemoryCache(max_entries, now);

  return {
    ttl_ms,
    lookup(text: string): ReadonlyArray<number> | null {
      return store.get(canonicalizeForCache(text));
    },
    remember(text: string, embedding: ReadonlyArray<number>): void {
      store.set(canonicalizeForCache(text), embedding, now() + ttl_ms);
    },
  };
}
