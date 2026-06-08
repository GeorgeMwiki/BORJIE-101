/**
 * Redis-backed token revocation blocklist (HPA-safe).
 *
 * Why this exists:
 *   `token-blocklist.ts`'s `InProcessTokenBlocklist` is a per-process
 *   `Map`. The api-gateway HPA scales 3-20 replicas, so `/auth/logout`
 *   (and refresh-token rotation / role-change revocation) only takes
 *   effect on the replica that served the request — every OTHER replica
 *   still honours the "revoked" token until its natural `exp`. That is an
 *   authn-bypass-after-logout window proportional to the token TTL.
 *
 *   This adapter consults a SHARED Redis store on every verify so a
 *   revocation propagates to all replicas in a single hop.
 *
 * Key shape:
 *   `blk:<jti>` → `'1'`, with `PXAT <exp*1000>` so Redis auto-expires the
 *   marker at the token's own expiry — no reaper thread needed.
 *
 * Degraded mode:
 *   On a Redis error during a check we surface the degraded state via the
 *   shared status flag (so `/health/deep` can page ops) and the FAÇADE
 *   (token-blocklist.ts) falls back to its in-process Map — which still
 *   catches same-replica logouts. We do NOT 500 every request (availability)
 *   but we never silently swallow the gap. This mirrors the rate-limiter's
 *   degrade philosophy in `rate-limit-redis.middleware.ts`.
 *
 * This module never reads `process.env` for the Redis URL — the connected
 * ioredis client is injected at boot from `index.ts` (the SAME client the
 * rate limiter uses), per the no-process.env-outside-bootstrap hard rule.
 */

import type { Redis as IoRedisClient } from 'ioredis';

/** Tiny revocation-store interface — the façade delegates to this. */
export interface TokenRevocationStore {
  /** Revoke a token by jti; the marker auto-expires at the token's own exp (seconds). */
  revoke(jti: string, exp: number): Promise<void>;
  /** True iff the jti is revoked and not yet expired. */
  isRevoked(jti: string): Promise<boolean>;
}

/**
 * Process-level status for the revocation Redis client. Flipped to
 * `'down'` the moment a Redis op raises and back to `'up'` on the next
 * success. Exposed via `getTokenBlocklistRedisStatus` so the deep-health
 * probe can flag the degraded mode cluster-wide.
 */
interface TokenBlocklistRedisStatus {
  status: 'up' | 'down' | 'unknown';
  firstFallbackAt: string | null;
  lastFallbackAt: string | null;
  fallbackCount: number;
  lastError: string | null;
}

const sharedStatus: TokenBlocklistRedisStatus = {
  status: 'unknown',
  firstFallbackAt: null,
  lastFallbackAt: null,
  fallbackCount: 0,
  lastError: null,
};

export function getTokenBlocklistRedisStatus(): Readonly<TokenBlocklistRedisStatus> {
  return { ...sharedStatus };
}

/** Test-only: reset the shared status between tests. */
export function __resetTokenBlocklistRedisStatus(): void {
  sharedStatus.status = 'unknown';
  sharedStatus.firstFallbackAt = null;
  sharedStatus.lastFallbackAt = null;
  sharedStatus.fallbackCount = 0;
  sharedStatus.lastError = null;
}

export interface RedisTokenBlocklistOptions {
  readonly redis: IoRedisClient;
  /** Key prefix; defaults to `blk:`. */
  readonly keyPrefix?: string;
  /** Optional Pino-style logger — `warn` on the degraded transition. */
  readonly logger?: { warn: (meta: unknown, msg: string) => void };
  /** Optional Sentry hook fired on every Redis fallback. */
  readonly sentryCapture?: (err: unknown, context?: Record<string, unknown>) => void;
}

/**
 * Redis-backed revocation store. The marker key is set with `PXAT` so the
 * server reaps it at the token's own expiry; `isRevoked` is a single
 * `EXISTS` hop. On a Redis error the method REJECTS so the façade can fall
 * back to the in-process Map (never silently treat as "not revoked").
 */
export class RedisTokenBlocklist implements TokenRevocationStore {
  readonly #redis: IoRedisClient;
  readonly #prefix: string;
  readonly #logger: RedisTokenBlocklistOptions['logger'];
  readonly #sentry: RedisTokenBlocklistOptions['sentryCapture'];

  constructor(opts: RedisTokenBlocklistOptions) {
    this.#redis = opts.redis;
    this.#prefix = opts.keyPrefix ?? 'blk:';
    this.#logger = opts.logger;
    this.#sentry = opts.sentryCapture;
  }

  #key(jti: string): string {
    return `${this.#prefix}${jti}`;
  }

  #degrade(err: unknown): void {
    const nowIso = new Date().toISOString();
    sharedStatus.status = 'down';
    sharedStatus.lastFallbackAt = nowIso;
    if (sharedStatus.firstFallbackAt === null) {
      sharedStatus.firstFallbackAt = nowIso;
    }
    sharedStatus.fallbackCount += 1;
    sharedStatus.lastError = err instanceof Error ? err.message : String(err);
    this.#logger?.warn(
      {
        err: sharedStatus.lastError,
        fallbackCount: sharedStatus.fallbackCount,
        firstFallbackAt: sharedStatus.firstFallbackAt,
      },
      'token-blocklist: redis unavailable — falling back to in-process map',
    );
    try {
      this.#sentry?.(err, {
        scope: 'token-blocklist',
        fallbackCount: sharedStatus.fallbackCount,
      });
    } catch {
      // Sentry hook bugs must never break the auth pipeline.
    }
  }

  #recover(): void {
    if (sharedStatus.status !== 'up') {
      sharedStatus.status = 'up';
    }
  }

  async revoke(jti: string, exp: number): Promise<void> {
    if (!jti) return;
    // `exp` is epoch seconds per the JWT spec. PXAT wants epoch ms.
    const expiresAtMs = exp * 1000;
    // If the token has already expired there is nothing to revoke.
    if (expiresAtMs <= Date.now()) return;
    try {
      await this.#redis.set(this.#key(jti), '1', 'PXAT', expiresAtMs);
      this.#recover();
    } catch (err) {
      this.#degrade(err);
      // Re-throw so the façade can ALSO mark it in the local Map — a
      // revoke that only landed locally is better than one that vanished.
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    if (!jti) return false;
    try {
      const exists = await this.#redis.exists(this.#key(jti));
      this.#recover();
      return exists === 1;
    } catch (err) {
      this.#degrade(err);
      // Re-throw so the façade decides the fallback posture (local Map).
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
