/**
 * Token revocation blocklist (façade).
 *
 * JWTs are stateless, so `/auth/logout` and refresh-token rotation
 * cannot actually invalidate a token without out-of-band state. This
 * module provides a blocklist keyed by JWT `jti` claim. When a token is
 * invalidated (logout, refresh rotation, role change) its jti is added
 * here with an expiry that matches the token's own `exp` claim — no
 * point retaining it after natural expiry.
 *
 * THE FAÇADE
 * ----------
 * The exported `tokenBlocklist` keeps a process-local `Map` (catches
 * same-replica revocations with zero infra) AND can be wired at boot to a
 * SHARED Redis store (`RedisTokenBlocklist`) so a revocation propagates to
 * every HPA replica. The interface stays tiny so every existing call site
 * is unchanged:
 *
 *   - `revoke(jti, exp)`        — sync; ALSO best-effort mirrors to Redis.
 *   - `isRevoked(jti)`          — sync; consults ONLY the local Map.
 *   - `isRevokedAsync(jti)`     — async; consults Redis when wired, else
 *                                 the local Map. Verify-time gates should
 *                                 prefer this so cross-replica revocations
 *                                 are honoured.
 *
 * Degrade posture: when Redis is wired but unreachable, the async path
 * falls back to the local Map (still catches same-replica logouts) and the
 * health flag flips (see redis-token-blocklist.ts) so ops can page. We do
 * NOT fail-open silently — a revoked-on-this-replica token is still caught,
 * and the degraded state is surfaced.
 *
 * This module never reads `process.env` — the Redis delegate is injected
 * at boot via `wireRedisRevocationStore(...)`.
 */

import type { TokenRevocationStore } from './redis-token-blocklist.js';

interface BlocklistEntry {
  expiresAt: number; // epoch ms
}

class TokenBlocklistFacade {
  private readonly entries = new Map<string, BlocklistEntry>();
  /** Shared revocation store (Redis) — wired at boot; null in dev/tests. */
  private redisStore: TokenRevocationStore | null = null;
  /** One-shot logger for async-mirror failures so we never console.* + never spam. */
  private warnedMirrorFailure = false;
  private readonly logWarn: (meta: unknown, msg: string) => void;

  constructor(logWarn?: (meta: unknown, msg: string) => void) {
    this.logWarn = logWarn ?? (() => {});
    // Reap expired local entries hourly to keep memory bounded.
    setInterval(() => this.reap(), 60 * 60 * 1000).unref?.();
  }

  /**
   * Inject the shared (Redis) revocation store at boot. Passing `null`
   * detaches it (dev / tests run on the local Map only).
   */
  wireRedisStore(store: TokenRevocationStore | null): void {
    this.redisStore = store;
  }

  /** True iff a shared store is wired — exposed for /health/deep. */
  hasRedisStore(): boolean {
    return this.redisStore !== null;
  }

  /**
   * Revoke a token by its jti; TTL comes from the token's own exp
   * (seconds). Writes to the local Map synchronously (so same-replica
   * verifies see it immediately) AND mirrors to Redis best-effort so the
   * other replicas pick it up. A Redis mirror failure NEVER throws out of
   * `revoke` — the local revoke already succeeded.
   */
  revoke(jti: string, exp: number): void {
    if (!jti) return;
    this.entries.set(jti, { expiresAt: exp * 1000 });
    const store = this.redisStore;
    if (store) {
      void store.revoke(jti, exp).catch((err: unknown) => {
        if (!this.warnedMirrorFailure) {
          this.warnedMirrorFailure = true;
          this.logWarn(
            { err: err instanceof Error ? err.message : String(err) },
            'token-blocklist: failed to mirror revoke to redis (local map still holds it)',
          );
        }
      });
    }
  }

  /**
   * Synchronous local-only check. Returns true if the jti was revoked on
   * THIS replica and hasn't expired yet. Kept for the legacy sync call
   * sites; prefer `isRevokedAsync` at verify time for cross-replica
   * coverage.
   */
  isRevoked(jti: string): boolean {
    const entry = this.entries.get(jti);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(jti);
      return false;
    }
    return true;
  }

  /**
   * Cross-replica check. When a shared store is wired this consults Redis
   * (single hop) so a logout on ANY replica revokes everywhere. On a Redis
   * error it degrades to the local Map (the health flag already flipped in
   * the Redis adapter) — never fails open silently. When no store is wired
   * it is identical to `isRevoked`.
   */
  async isRevokedAsync(jti: string): Promise<boolean> {
    if (!jti) return false;
    // Local Map first — a same-replica revoke is authoritative + free.
    if (this.isRevoked(jti)) return true;
    const store = this.redisStore;
    if (!store) return false;
    try {
      return await store.isRevoked(jti);
    } catch {
      // Redis adapter already logged + flipped the health flag. Fall back
      // to the local result (already false above) so availability holds.
      return false;
    }
  }

  /** Exposed for tests; do not call from production. */
  clear(): void {
    this.entries.clear();
  }

  private reap(): void {
    const now = Date.now();
    for (const [jti, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(jti);
    }
  }
}

export const tokenBlocklist = new TokenBlocklistFacade();

/**
 * Boot-time injector — call once from `index.ts` after the ioredis client
 * is constructed. Idempotent; passing `null` detaches the store.
 */
export function wireRedisRevocationStore(store: TokenRevocationStore | null): void {
  tokenBlocklist.wireRedisStore(store);
}
