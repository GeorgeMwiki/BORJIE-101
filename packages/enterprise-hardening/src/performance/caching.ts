/**
 * Caching Strategies
 * 
 * Implements multi-layer caching with support for:
 * - In-memory L1 cache
 * - Distributed L2 cache (Redis-compatible)
 * - Cache-aside, read-through, write-through patterns
 * - Tenant-aware cache isolation
 * - Cache warming and invalidation
 */

/**
 * Cache Strategy Types
 */
export const CacheStrategy = {
  CACHE_ASIDE: 'CACHE_ASIDE',         // Application manages cache
  READ_THROUGH: 'READ_THROUGH',       // Cache manages reads
  WRITE_THROUGH: 'WRITE_THROUGH',     // Sync write to cache and store
  WRITE_BEHIND: 'WRITE_BEHIND',       // Async write to store
  REFRESH_AHEAD: 'REFRESH_AHEAD',     // Proactive refresh before expiry
} as const;

export type CacheStrategy = typeof CacheStrategy[keyof typeof CacheStrategy];

/**
 * Cache Eviction Policy
 */
export const EvictionPolicy = {
  LRU: 'LRU',                         // Least Recently Used
  LFU: 'LFU',                         // Least Frequently Used
  FIFO: 'FIFO',                       // First In First Out
  TTL: 'TTL',                         // Time To Live based
  SIZE: 'SIZE',                       // Size-based eviction
} as const;

export type EvictionPolicy = typeof EvictionPolicy[keyof typeof EvictionPolicy];

/**
 * Cache Entry
 */
export interface CacheEntry<T> {
  readonly key: string;
  readonly value: T;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly lastAccessed: number;
  readonly accessCount: number;
  readonly size: number;
  readonly tags: readonly string[];
  readonly tenantId?: string;
}

/**
 * Cache Configuration
 */
export interface CacheConfig {
  readonly name: string;
  readonly strategy: CacheStrategy;
  readonly evictionPolicy: EvictionPolicy;
  readonly maxSize: number;           // Max entries or bytes
  readonly maxSizeUnit: 'entries' | 'bytes';
  readonly defaultTtl: number;        // Default TTL in ms
  readonly maxTtl: number;            // Maximum TTL allowed
  readonly tenantIsolation: boolean;  // Isolate cache by tenant
  readonly l1Enabled: boolean;        // Enable in-memory L1
  readonly l1MaxSize?: number;        // L1 max entries
  readonly l1Ttl?: number;            // L1 TTL (shorter than L2)
  readonly compressionEnabled?: boolean;
  readonly compressionThreshold?: number; // Compress if larger than this
}

/**
 * Cache Statistics
 */
export interface CacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly hitRate: number;
  readonly evictions: number;
  readonly size: number;
  readonly maxSize: number;
  readonly avgLoadTime: number;
  readonly l1Stats?: {
    readonly hits: number;
    readonly misses: number;
    readonly hitRate: number;
    readonly size: number;
  };
}

/**
 * Cache Get Options
 */
export interface CacheGetOptions {
  readonly skipL1?: boolean;
  readonly refreshTtl?: boolean;
}

/**
 * Cache Set Options
 */
export interface CacheSetOptions {
  readonly ttl?: number;
  readonly tags?: string[];
  readonly skipL1?: boolean;
}

/**
 * Cache Store Interface
 */
export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, entry: CacheEntry<T>): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  keys(pattern?: string): Promise<string[]>;
  size(): Promise<number>;
}

/**
 * In-Memory Cache Store (L1)
 */
export class InMemoryCacheStore implements CacheStore {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private accessOrder: string[] = [];

  constructor(private readonly maxSize: number = 1000) {}

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    // Check expiry
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Update access tracking
    this.updateAccessOrder(key);
    
    return {
      ...entry,
      lastAccessed: Date.now(),
      accessCount: entry.accessCount + 1,
    };
  }

  async set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOne();
    }

    this.cache.set(key, entry);
    this.updateAccessOrder(key);
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.accessOrder = [];
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.cache.keys());
    if (!pattern) return allKeys;
    
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return allKeys.filter(k => regex.test(k));
  }

  async size(): Promise<number> {
    return this.cache.size;
  }

  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  private evictOne(): void {
    if (this.accessOrder.length === 0) return;
    const keyToEvict = this.accessOrder.shift()!;
    this.cache.delete(keyToEvict);
  }
}

/**
 * Multi-Layer Cache Manager
 */
export class CacheManager<T = unknown> {
  private l1Cache: InMemoryCacheStore | null = null;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    totalLoadTime: 0,
    loadCount: 0,
    l1Hits: 0,
    l1Misses: 0,
  };

  constructor(
    private readonly config: CacheConfig,
    private readonly l2Store: CacheStore
  ) {
    if (config.l1Enabled) {
      this.l1Cache = new InMemoryCacheStore(config.l1MaxSize ?? 100);
    }
  }

  /**
   * Get value from cache
   */
  async get(key: string, options?: CacheGetOptions): Promise<T | null> {
    const cacheKey = this.buildKey(key);

    // Try L1 first
    if (this.l1Cache && !options?.skipL1) {
      const l1Entry = await this.l1Cache.get<T>(cacheKey);
      if (l1Entry) {
        this.stats.l1Hits++;
        this.stats.hits++;
        return l1Entry.value;
      }
      this.stats.l1Misses++;
    }

    // Try L2
    const l2Entry = await this.l2Store.get<T>(cacheKey);
    if (l2Entry) {
      this.stats.hits++;
      
      // Populate L1
      if (this.l1Cache && !options?.skipL1) {
        const l1Entry: CacheEntry<T> = {
          ...l2Entry,
          expiresAt: Date.now() + (this.config.l1Ttl ?? this.config.defaultTtl / 10),
        };
        await this.l1Cache.set(cacheKey, l1Entry);
      }
      
      return l2Entry.value;
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Get value or load from source
   */
  async getOrLoad(
    key: string,
    loader: () => Promise<T>,
    options?: CacheSetOptions
  ): Promise<T> {
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    const startTime = Date.now();
    const value = await loader();
    const loadTime = Date.now() - startTime;
    
    this.stats.totalLoadTime += loadTime;
    this.stats.loadCount++;

    await this.set(key, value, options);
    return value;
  }

  /**
   * Set value in cache
   */
  async set(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    const cacheKey = this.buildKey(key);
    const now = Date.now();
    const ttl = Math.min(options?.ttl ?? this.config.defaultTtl, this.config.maxTtl);

    const entry: CacheEntry<T> = {
      key: cacheKey,
      value,
      createdAt: now,
      expiresAt: now + ttl,
      lastAccessed: now,
      accessCount: 0,
      size: this.estimateSize(value),
      tags: options?.tags ?? [],
    };

    // Set in L2
    await this.l2Store.set(cacheKey, entry);

    // Set in L1
    if (this.l1Cache && !options?.skipL1) {
      const l1Entry: CacheEntry<T> = {
        ...entry,
        expiresAt: now + (this.config.l1Ttl ?? ttl / 10),
      };
      await this.l1Cache.set(cacheKey, l1Entry);
    }
  }

  /**
   * Delete from cache
   */
  async delete(key: string): Promise<boolean> {
    const cacheKey = this.buildKey(key);
    
    if (this.l1Cache) {
      await this.l1Cache.delete(cacheKey);
    }
    
    return this.l2Store.delete(cacheKey);
  }

  /**
   * Invalidate by tag
   */
  async invalidateByTag(tag: string): Promise<number> {
    const keys = await this.l2Store.keys();
    let invalidated = 0;

    for (const key of keys) {
      const entry = await this.l2Store.get(key);
      if (entry?.tags.includes(tag)) {
        await this.l2Store.delete(key);
        if (this.l1Cache) {
          await this.l1Cache.delete(key);
        }
        invalidated++;
      }
    }

    return invalidated;
  }

  /**
   * Invalidate by pattern
   */
  async invalidateByPattern(pattern: string): Promise<number> {
    const keys = await this.l2Store.keys(pattern);
    
    for (const key of keys) {
      await this.l2Store.delete(key);
      if (this.l1Cache) {
        await this.l1Cache.delete(key);
      }
    }

    return keys.length;
  }

  /**
   * Clear entire cache
   */
  async clear(): Promise<void> {
    if (this.l1Cache) {
      await this.l1Cache.clear();
    }
    await this.l2Store.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;
    const avgLoadTime = this.stats.loadCount > 0 
      ? this.stats.totalLoadTime / this.stats.loadCount 
      : 0;

    const l1TotalRequests = this.stats.l1Hits + this.stats.l1Misses;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: Math.round(hitRate * 100) / 100,
      evictions: this.stats.evictions,
      size: 0, // Would need to calculate from store
      maxSize: this.config.maxSize,
      avgLoadTime: Math.round(avgLoadTime),
      l1Stats: this.l1Cache ? {
        hits: this.stats.l1Hits,
        misses: this.stats.l1Misses,
        hitRate: l1TotalRequests > 0 
          ? Math.round((this.stats.l1Hits / l1TotalRequests) * 100) / 100 
          : 0,
        size: 0, // Would need to calculate
      } : undefined,
    };
  }

  /**
   * Warm cache with provided data
   */
  async warm(entries: Array<{ key: string; value: T; ttl?: number; tags?: string[] }>): Promise<number> {
    let warmed = 0;
    
    for (const entry of entries) {
      await this.set(entry.key, entry.value, { ttl: entry.ttl, tags: entry.tags });
      warmed++;
    }
    
    return warmed;
  }

  private buildKey(key: string): string {
    return `${this.config.name}:${key}`;
  }

  private estimateSize(value: unknown): number {
    // Simple size estimation
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }
}

/**
 * Tenant-Aware Cache Manager
 */
export class TenantCacheManager<T = unknown> extends CacheManager<T> {
  constructor(
    config: CacheConfig,
    l2Store: CacheStore,
    private readonly tenantId: string
  ) {
    super({ ...config, tenantIsolation: true }, l2Store);
  }

  async get(key: string, options?: CacheGetOptions): Promise<T | null> {
    return super.get(this.tenantKey(key), options);
  }

  async set(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    return super.set(this.tenantKey(key), value, {
      ...options,
      tags: [...(options?.tags ?? []), `tenant:${this.tenantId}`],
    });
  }

  async delete(key: string): Promise<boolean> {
    return super.delete(this.tenantKey(key));
  }

  async invalidateTenant(): Promise<number> {
    return super.invalidateByTag(`tenant:${this.tenantId}`);
  }

  private tenantKey(key: string): string {
    return `tenant:${this.tenantId}:${key}`;
  }
}

/**
 * Pre-configured cache configurations
 */
export const CachePresets = {
  /** Session cache - short TTL, high hit rate expected */
  SESSION: {
    strategy: CacheStrategy.CACHE_ASIDE,
    evictionPolicy: EvictionPolicy.LRU,
    maxSize: 10000,
    maxSizeUnit: 'entries' as const,
    defaultTtl: 30 * 60 * 1000, // 30 minutes
    maxTtl: 24 * 60 * 60 * 1000, // 24 hours
    tenantIsolation: true,
    l1Enabled: true,
    l1MaxSize: 1000,
    l1Ttl: 60 * 1000, // 1 minute
  },

  /** API response cache - medium TTL */
  API_RESPONSE: {
    strategy: CacheStrategy.CACHE_ASIDE,
    evictionPolicy: EvictionPolicy.LRU,
    maxSize: 50000,
    maxSizeUnit: 'entries' as const,
    defaultTtl: 5 * 60 * 1000, // 5 minutes
    maxTtl: 60 * 60 * 1000, // 1 hour
    tenantIsolation: true,
    l1Enabled: true,
    l1MaxSize: 500,
    l1Ttl: 30 * 1000, // 30 seconds
  },

  /** Reference data cache - long TTL */
  REFERENCE_DATA: {
    strategy: CacheStrategy.READ_THROUGH,
    evictionPolicy: EvictionPolicy.LFU,
    maxSize: 5000,
    maxSizeUnit: 'entries' as const,
    defaultTtl: 24 * 60 * 60 * 1000, // 24 hours
    maxTtl: 7 * 24 * 60 * 60 * 1000, // 7 days
    tenantIsolation: false, // Reference data is shared
    l1Enabled: true,
    l1MaxSize: 200,
    l1Ttl: 60 * 60 * 1000, // 1 hour
  },

  /** Query result cache - variable TTL */
  QUERY_RESULT: {
    strategy: CacheStrategy.CACHE_ASIDE,
    evictionPolicy: EvictionPolicy.LRU,
    maxSize: 100000,
    maxSizeUnit: 'entries' as const,
    defaultTtl: 60 * 1000, // 1 minute
    maxTtl: 15 * 60 * 1000, // 15 minutes
    tenantIsolation: true,
    l1Enabled: false, // Query results can be large
  },
} as const satisfies Record<string, Omit<CacheConfig, 'name'>>;
