/**
 * Idempotency middleware — SCAFFOLDED 10
 *
 * Clients may send an `Idempotency-Key` header on POST/PUT/PATCH requests
 * to make retries safe. This middleware caches the first response per
 * `(tenantId, idempotencyKey)` for 24h and replays it on subsequent calls.
 *
 * Cache backend is pluggable — the default is an in-memory LRU that should
 * only be used in tests/dev. Production deployments should inject a Redis-
 * backed store via `createIdempotencyStore()`.
 */

import type { Context, MiddlewareHandler } from 'hono';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  cachedAt: number;
}

export interface IdempotencyStore {
  get(key: string): Promise<CachedResponse | undefined>;
  set(key: string, value: CachedResponse, ttlMs: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Redis-backed store (import Redis client at call site to avoid coupling)
// ---------------------------------------------------------------------------

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { PX?: number; EX?: number }): Promise<unknown>;
}

export function createRedisIdempotencyStore(redis: RedisLike): IdempotencyStore {
  return {
    async get(key) {
      const raw = await redis.get(key);
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as CachedResponse;
      } catch {
        return undefined;
      }
    },
    async set(key, value, ttlMs) {
      await redis.set(key, JSON.stringify(value), { PX: ttlMs });
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

export function createInMemoryIdempotencyStore(): IdempotencyStore {
  const cache = new Map<string, { value: CachedResponse; expiresAt: number }>();
  return {
    async get(key) {
      const entry = cache.get(key);
      if (!entry) return undefined;
      if (Date.now() >= entry.expiresAt) {
        cache.delete(key);
        return undefined;
      }
      return entry.value;
    },
    async set(key, value, ttlMs) {
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
  };
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

function keyFor(tenantId: string, idempotencyKey: string): string {
  // CRITICAL-7: tenantId must be a verified string at this point. The
  // middleware caller is responsible for never passing undefined.
  return `idem:${tenantId}:${idempotencyKey}`;
}

// ---------------------------------------------------------------------------
// Hono middleware factory
// ---------------------------------------------------------------------------

export interface IdempotencyMiddlewareOptions {
  store: IdempotencyStore;
  ttlMs?: number;
}

export function createIdempotencyMiddleware(
  options: IdempotencyMiddlewareOptions
): MiddlewareHandler {
  const ttl = options.ttlMs ?? TTL_MS;

  return async (c: Context, next) => {
    if (!MUTATION_METHODS.has(c.req.method)) {
      await next();
      return;
    }

    const idempotencyKey = c.req.header('idempotency-key');
    if (!idempotencyKey) {
      await next();
      return;
    }

    // CRITICAL-7 (audit .audit/post-pr90-api-mcp-bug-sweep.md):
    // NEVER trust the `x-tenant-id` header fallback. If the middleware
    // mounts before authMiddleware (or on a route in the auth-allowlist),
    // the body-supplied header lets a caller poison another tenant's
    // idempotency cache. The authoritative tenant id comes from the
    // verified JWT principal only. When the auth context is missing we
    // skip caching entirely — better to retry-execute than to leak
    // responses across tenants.
    const tenantId = (c.get('auth') as { tenantId?: string } | undefined)
      ?.tenantId;
    if (!tenantId) {
      await next();
      return;
    }
    const key = keyFor(tenantId, idempotencyKey);

    const cached = await options.store.get(key);
    if (cached) {
      // Replay — clone headers to preserve downstream content-type etc.
      for (const [h, v] of Object.entries(cached.headers)) {
        c.header(h, v);
      }
      c.header('idempotent-replayed', 'true');
      return c.json(cached.body, cached.status as 200 | 201);
    }

    await next();

    // Capture the fresh response and cache it — only for 2xx so error
    // responses can be retried (error responses are NOT idempotent).
    const status = c.res.status;
    if (status >= 200 && status < 300) {
      try {
        const cloned = c.res.clone();
        const text = await cloned.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
        const headers: Record<string, string> = {};
        cloned.headers.forEach((value, name) => {
          // Strip hop-by-hop and per-response headers we shouldn't replay.
          if (['content-length', 'date', 'connection'].includes(name.toLowerCase())) return;
          headers[name] = value;
        });
        await options.store.set(
          key,
          {
            status,
            body: parsed,
            headers,
            cachedAt: Date.now(),
          },
          ttl
        );
      } catch {
        // Cache write failures are non-fatal — just log if a logger were
        // available. We don't want to break the request.
      }
    }
  };
}
