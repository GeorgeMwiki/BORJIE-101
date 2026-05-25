/**
 * Rate Limiter Implementation
 * 
 * Implements multiple rate limiting algorithms for API protection:
 * - Token Bucket: Smooth rate limiting with burst capacity
 * - Sliding Window: Precise rate limiting with rolling window
 * - Fixed Window: Simple time-based rate limiting
 * 
 * Supports multi-tenant rate limiting with configurable limits per tenant,
 * user, API key, or IP address.
 */

/**
 * Rate Limiting Algorithm Types
 */
export const RateLimitAlgorithm = {
  TOKEN_BUCKET: 'TOKEN_BUCKET',
  SLIDING_WINDOW: 'SLIDING_WINDOW',
  FIXED_WINDOW: 'FIXED_WINDOW',
} as const;

export type RateLimitAlgorithm = typeof RateLimitAlgorithm[keyof typeof RateLimitAlgorithm];

/**
 * Rate Limit Scope
 */
export const RateLimitScope = {
  GLOBAL: 'GLOBAL',         // Applies across all requests
  TENANT: 'TENANT',         // Per-tenant limit
  USER: 'USER',             // Per-user limit
  API_KEY: 'API_KEY',       // Per-API-key limit
  IP: 'IP',                 // Per-IP limit
  ENDPOINT: 'ENDPOINT',     // Per-endpoint limit
  COMPOSITE: 'COMPOSITE',   // Multiple dimensions combined
} as const;

export type RateLimitScope = typeof RateLimitScope[keyof typeof RateLimitScope];

/**
 * Rate Limit Configuration
 */
export interface RateLimitConfig {
  /** Unique identifier for this rate limit rule */
  readonly name: string;
  /** Maximum requests allowed in the window */
  readonly maxRequests: number;
  /** Time window in milliseconds */
  readonly windowMs: number;
  /** Algorithm to use */
  readonly algorithm: RateLimitAlgorithm;
  /** Scope of rate limiting */
  readonly scope: RateLimitScope;
  /** For token bucket: tokens added per interval */
  readonly refillRate?: number;
  /** For token bucket: refill interval in ms */
  readonly refillIntervalMs?: number;
  /** Maximum burst size (token bucket) */
  readonly burstSize?: number;
  /** Skip rate limiting for these identifiers */
  readonly skipList?: readonly string[];
  /** Custom message when rate limited */
  readonly message?: string;
  /** HTTP status code when rate limited */
  readonly statusCode?: number;
}

/**
 * Rate Limit Result
 */
export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly limit: number;
  readonly resetAt: number;
  readonly retryAfter?: number;
  readonly headers: RateLimitHeaders;
}

/**
 * Standard rate limit headers
 */
export interface RateLimitHeaders {
  readonly 'X-RateLimit-Limit': string;
  readonly 'X-RateLimit-Remaining': string;
  readonly 'X-RateLimit-Reset': string;
  readonly 'Retry-After'?: string;
}

/**
 * Request context for rate limiting
 */
export interface RateLimitContext {
  readonly tenantId?: string;
  readonly userId?: string;
  readonly apiKeyId?: string;
  readonly ipAddress?: string;
  readonly endpoint?: string;
  readonly method?: string;
}

/**
 * Storage interface for rate limit state
 */
export interface RateLimitStore {
  get(key: string): Promise<RateLimitState | null>;
  set(key: string, state: RateLimitState, ttlMs: number): Promise<void>;
  increment(key: string, amount: number, ttlMs: number): Promise<number>;
  getMultiple(keys: string[]): Promise<Map<string, RateLimitState>>;
}

/**
 * Rate limit state stored per key
 */
export interface RateLimitState {
  readonly count: number;
  readonly windowStart: number;
  readonly tokens?: number;
  readonly lastRefill?: number;
}

/**
 * In-memory rate limit store (for single-instance or testing)
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private store: Map<string, { state: RateLimitState; expiresAt: number }> = new Map();

  async get(key: string): Promise<RateLimitState | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.state;
  }

  async set(key: string, state: RateLimitState, ttlMs: number): Promise<void> {
    this.store.set(key, {
      state,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async increment(key: string, amount: number, ttlMs: number): Promise<number> {
    const existing = await this.get(key);
    const newCount = (existing?.count ?? 0) + amount;
    await this.set(
      key,
      { count: newCount, windowStart: existing?.windowStart ?? Date.now() },
      ttlMs
    );
    return newCount;
  }

  async getMultiple(keys: string[]): Promise<Map<string, RateLimitState>> {
    const result = new Map<string, RateLimitState>();
    for (const key of keys) {
      const state = await this.get(key);
      if (state) result.set(key, state);
    }
    return result;
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * Rate Limiter Implementation
 */
export class RateLimiter {
  constructor(
    private readonly config: RateLimitConfig,
    private readonly store: RateLimitStore = new InMemoryRateLimitStore()
  ) {}

  /**
   * Check if request is allowed
   */
  async check(context: RateLimitContext): Promise<RateLimitResult> {
    const key = this.buildKey(context);

    // Check skip list
    if (this.config.skipList?.includes(key)) {
      return this.createAllowedResult();
    }

    switch (this.config.algorithm) {
      case RateLimitAlgorithm.TOKEN_BUCKET:
        return this.checkTokenBucket(key);
      case RateLimitAlgorithm.SLIDING_WINDOW:
        return this.checkSlidingWindow(key);
      case RateLimitAlgorithm.FIXED_WINDOW:
      default:
        return this.checkFixedWindow(key);
    }
  }

  /**
   * Build storage key based on scope
   */
  private buildKey(context: RateLimitContext): string {
    const parts = [this.config.name];

    switch (this.config.scope) {
      case RateLimitScope.GLOBAL:
        parts.push('global');
        break;
      case RateLimitScope.TENANT:
        parts.push(`tenant:${context.tenantId ?? 'unknown'}`);
        break;
      case RateLimitScope.USER:
        parts.push(`user:${context.userId ?? 'unknown'}`);
        break;
      case RateLimitScope.API_KEY:
        parts.push(`apikey:${context.apiKeyId ?? 'unknown'}`);
        break;
      case RateLimitScope.IP:
        parts.push(`ip:${context.ipAddress ?? 'unknown'}`);
        break;
      case RateLimitScope.ENDPOINT:
        parts.push(`endpoint:${context.method ?? 'GET'}:${context.endpoint ?? '/'}`);
        break;
      case RateLimitScope.COMPOSITE:
        if (context.tenantId) parts.push(`tenant:${context.tenantId}`);
        if (context.userId) parts.push(`user:${context.userId}`);
        if (context.endpoint) parts.push(`endpoint:${context.endpoint}`);
        break;
    }

    return parts.join(':');
  }

  /**
   * Fixed window rate limiting
   */
  private async checkFixedWindow(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / this.config.windowMs) * this.config.windowMs;
    const windowKey = `${key}:${windowStart}`;

    const state = await this.store.get(windowKey);
    const count = state?.count ?? 0;
    const remaining = Math.max(0, this.config.maxRequests - count - 1);
    const resetAt = windowStart + this.config.windowMs;

    if (count >= this.config.maxRequests) {
      return this.createDeniedResult(remaining, resetAt);
    }

    // Increment counter
    await this.store.increment(windowKey, 1, this.config.windowMs);

    return this.createAllowedResult(remaining, resetAt);
  }

  /**
   * Sliding window rate limiting
   */
  private async checkSlidingWindow(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const currentWindowKey = `${key}:current`;
    const previousWindowKey = `${key}:previous`;

    const [currentState, previousState] = await Promise.all([
      this.store.get(currentWindowKey),
      this.store.get(previousWindowKey),
    ]);

    // Calculate weighted count from previous and current windows
    const currentCount = currentState?.count ?? 0;
    const previousCount = previousState?.count ?? 0;
    
    const currentWindowStart = currentState?.windowStart ?? now;
    const elapsedInCurrent = now - currentWindowStart;
    const weight = 1 - (elapsedInCurrent / this.config.windowMs);
    const weightedPrevious = Math.floor(previousCount * Math.max(0, weight));
    
    const totalCount = currentCount + weightedPrevious;
    const remaining = Math.max(0, this.config.maxRequests - totalCount - 1);
    const resetAt = currentWindowStart + this.config.windowMs;

    if (totalCount >= this.config.maxRequests) {
      return this.createDeniedResult(remaining, resetAt);
    }

    // Increment current window
    await this.store.set(
      currentWindowKey,
      { count: currentCount + 1, windowStart: currentWindowStart },
      this.config.windowMs * 2
    );

    return this.createAllowedResult(remaining, resetAt);
  }

  /**
   * Token bucket rate limiting
   */
  private async checkTokenBucket(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const state = await this.store.get(key);

    const burstSize = this.config.burstSize ?? this.config.maxRequests;
    const refillRate = this.config.refillRate ?? this.config.maxRequests;
    const refillInterval = this.config.refillIntervalMs ?? this.config.windowMs;

    let tokens = state?.tokens ?? burstSize;
    const lastRefill = state?.lastRefill ?? now;

    // Refill tokens based on elapsed time
    const elapsed = now - lastRefill;
    const refills = Math.floor(elapsed / refillInterval);
    tokens = Math.min(burstSize, tokens + refills * refillRate);

    const remaining = Math.max(0, tokens - 1);
    const resetAt = now + (tokens <= 0 ? refillInterval : 0);

    if (tokens < 1) {
      return this.createDeniedResult(0, resetAt);
    }

    // Consume a token
    await this.store.set(
      key,
      {
        count: 0,
        windowStart: now,
        tokens: tokens - 1,
        lastRefill: lastRefill + refills * refillInterval,
      },
      this.config.windowMs * 2
    );

    return this.createAllowedResult(remaining, resetAt);
  }

  private createAllowedResult(remaining: number = this.config.maxRequests - 1, resetAt: number = Date.now() + this.config.windowMs): RateLimitResult {
    return {
      allowed: true,
      remaining,
      limit: this.config.maxRequests,
      resetAt,
      headers: {
        'X-RateLimit-Limit': String(this.config.maxRequests),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
      },
    };
  }

  private createDeniedResult(remaining: number, resetAt: number): RateLimitResult {
    const retryAfter = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
    return {
      allowed: false,
      remaining,
      limit: this.config.maxRequests,
      resetAt,
      retryAfter,
      headers: {
        'X-RateLimit-Limit': String(this.config.maxRequests),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
        'Retry-After': String(retryAfter),
      },
    };
  }
}

/**
 * Rate Limiter Registry - Manages multiple rate limiters
 */
export class RateLimiterRegistry {
  private limiters: Map<string, RateLimiter> = new Map();

  constructor(private readonly defaultStore: RateLimitStore = new InMemoryRateLimitStore()) {}

  /**
   * Register a rate limiter
   */
  register(config: RateLimitConfig, store?: RateLimitStore): RateLimiter {
    const limiter = new RateLimiter(config, store ?? this.defaultStore);
    this.limiters.set(config.name, limiter);
    return limiter;
  }

  /**
   * Get a rate limiter by name
   */
  get(name: string): RateLimiter | undefined {
    return this.limiters.get(name);
  }

  /**
   * Check request against multiple rate limiters
   */
  async checkAll(
    context: RateLimitContext,
    limiterNames?: string[]
  ): Promise<{
    allowed: boolean;
    results: Map<string, RateLimitResult>;
    denyingLimiter?: string;
  }> {
    const results = new Map<string, RateLimitResult>();
    const limitersToCheck = limiterNames
      ? limiterNames.map(n => this.limiters.get(n)).filter((l): l is RateLimiter => l !== undefined)
      : Array.from(this.limiters.values());

    let denyingLimiter: string | undefined;

    for (const limiter of limitersToCheck) {
      const result = await limiter.check(context);
      results.set(limiter['config'].name, result);
      
      if (!result.allowed && !denyingLimiter) {
        denyingLimiter = limiter['config'].name;
      }
    }

    return {
      allowed: !denyingLimiter,
      results,
      denyingLimiter,
    };
  }
}

/**
 * Pre-configured rate limit presets for common use cases
 */
export const RateLimitPresets = {
  /** Standard API rate limit */
  STANDARD_API: {
    maxRequests: 1000,
    windowMs: 60000, // 1 minute
    algorithm: RateLimitAlgorithm.SLIDING_WINDOW,
    scope: RateLimitScope.USER,
  },

  /** Authentication endpoints (stricter) */
  AUTHENTICATION: {
    maxRequests: 10,
    windowMs: 60000,
    algorithm: RateLimitAlgorithm.SLIDING_WINDOW,
    scope: RateLimitScope.IP,
  },

  /** Login attempts (very strict) */
  LOGIN: {
    maxRequests: 5,
    windowMs: 300000, // 5 minutes
    algorithm: RateLimitAlgorithm.FIXED_WINDOW,
    scope: RateLimitScope.COMPOSITE,
  },

  /** File upload endpoints */
  FILE_UPLOAD: {
    maxRequests: 50,
    windowMs: 3600000, // 1 hour
    algorithm: RateLimitAlgorithm.TOKEN_BUCKET,
    scope: RateLimitScope.USER,
    burstSize: 10,
    refillRate: 10,
    refillIntervalMs: 600000, // 10 minutes
  },

  /** Payment endpoints (moderate) */
  PAYMENT: {
    maxRequests: 30,
    windowMs: 60000,
    algorithm: RateLimitAlgorithm.SLIDING_WINDOW,
    scope: RateLimitScope.USER,
  },

  /** Search/query endpoints (generous) */
  SEARCH: {
    maxRequests: 100,
    windowMs: 60000,
    algorithm: RateLimitAlgorithm.TOKEN_BUCKET,
    scope: RateLimitScope.USER,
    burstSize: 20,
  },

  /** Webhook delivery (per tenant) */
  WEBHOOK: {
    maxRequests: 1000,
    windowMs: 60000,
    algorithm: RateLimitAlgorithm.SLIDING_WINDOW,
    scope: RateLimitScope.TENANT,
  },

  /** Report generation (expensive operation) */
  REPORT_GENERATION: {
    maxRequests: 10,
    windowMs: 3600000, // 1 hour
    algorithm: RateLimitAlgorithm.FIXED_WINDOW,
    scope: RateLimitScope.USER,
  },
} as const satisfies Record<string, Omit<RateLimitConfig, 'name'>>;
