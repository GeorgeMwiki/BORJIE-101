/**
 * SEC-G3 — Redis-backed token revocation (HPA-safe) unit tests.
 *
 * No live Redis. A minimal FakeRedis implements just the `set(... PXAT)` +
 * `exists` surface the blocklist uses, plus a controllable clock + a fail
 * switch so we can drive the degrade path.
 *
 * Coverage:
 *   - revoke → isRevoked true on the SAME shared store (cross-replica).
 *   - two "replicas" sharing one Redis both observe the revocation.
 *   - PXAT in the past → not revoked (Redis auto-expiry semantics).
 *   - Redis down → adapter rejects → façade degrades to local Map +
 *     flips the health flag.
 *   - façade.revoke mirrors to Redis; a mirror failure never throws.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Redis as IoRedisClient } from 'ioredis';
import {
  RedisTokenBlocklist,
  getTokenBlocklistRedisStatus,
  __resetTokenBlocklistRedisStatus,
} from '../redis-token-blocklist';
import { tokenBlocklist, wireRedisRevocationStore } from '../token-blocklist';

/** Narrow fake of the ioredis surface the blocklist consumes. */
class FakeRedis {
  private readonly store = new Map<string, number>(); // key → expiresAtMs
  // Start the fake clock at the real wall clock so PXAT comparisons line up
  // with the façade's local Map (which uses the real Date.now()).
  private nowMs = Date.now();
  /** When set, every op throws this error (drives the degrade path). */
  failWith: Error | null = null;

  advanceTime(ms: number): void {
    this.nowMs += ms;
  }

  private reapExpired(): void {
    for (const [k, exp] of this.store) {
      if (exp <= this.nowMs) this.store.delete(k);
    }
  }

  async set(
    key: string,
    _val: string,
    mode: string,
    at: number,
  ): Promise<'OK'> {
    if (this.failWith) throw this.failWith;
    if (mode !== 'PXAT') throw new Error(`unexpected set mode ${mode}`);
    this.store.set(key, at);
    return 'OK';
  }

  async exists(key: string): Promise<number> {
    if (this.failWith) throw this.failWith;
    this.reapExpired();
    return this.store.has(key) ? 1 : 0;
  }
}

function makeStore(fake: FakeRedis): RedisTokenBlocklist {
  return new RedisTokenBlocklist({
    redis: fake as unknown as IoRedisClient,
  });
}

// One hour into the real future (epoch SECONDS, per the JWT exp spec) so the
// marker is live against both the real Date.now() and the FakeRedis clock.
const FUTURE_EXP_S = Math.floor(Date.now() / 1000) + 3600;

describe('RedisTokenBlocklist', () => {
  beforeEach(() => {
    __resetTokenBlocklistRedisStatus();
  });

  it('revoke then isRevoked returns true on the shared store', async () => {
    const fake = new FakeRedis();
    const store = makeStore(fake);
    await store.revoke('jti-1', FUTURE_EXP_S);
    expect(await store.isRevoked('jti-1')).toBe(true);
    expect(await store.isRevoked('jti-unknown')).toBe(false);
  });

  it('two replicas sharing one Redis both see the revocation', async () => {
    const fake = new FakeRedis();
    const replicaA = makeStore(fake);
    const replicaB = makeStore(fake);
    // Replica A serves the logout.
    await replicaA.revoke('jti-shared', FUTURE_EXP_S);
    // Replica B (different process, same Redis) must observe it.
    expect(await replicaB.isRevoked('jti-shared')).toBe(true);
  });

  it('PXAT in the past makes the marker absent (auto-expiry)', async () => {
    const fake = new FakeRedis();
    const store = makeStore(fake);
    await store.revoke('jti-ttl', FUTURE_EXP_S);
    expect(await store.isRevoked('jti-ttl')).toBe(true);
    // Advance past the token's own exp (1h); Redis would have reaped the key.
    fake.advanceTime(3600_000 + 60_000);
    expect(await store.isRevoked('jti-ttl')).toBe(false);
  });

  it('already-expired exp is a no-op revoke', async () => {
    const fake = new FakeRedis();
    const store = makeStore(fake);
    // exp far in the past relative to the (real) Date.now in revoke()'s guard.
    await store.revoke('jti-stale', 1);
    expect(await store.isRevoked('jti-stale')).toBe(false);
  });

  it('Redis error during check rejects and flips the health flag', async () => {
    const fake = new FakeRedis();
    const store = makeStore(fake);
    fake.failWith = new Error('ECONNREFUSED');
    await expect(store.isRevoked('jti-x')).rejects.toThrow();
    expect(getTokenBlocklistRedisStatus().status).toBe('down');
    expect(getTokenBlocklistRedisStatus().fallbackCount).toBeGreaterThan(0);
  });
});

describe('token-blocklist façade with Redis store', () => {
  beforeEach(() => {
    tokenBlocklist.clear();
    wireRedisRevocationStore(null);
    __resetTokenBlocklistRedisStatus();
  });

  it('isRevokedAsync consults Redis when wired (cross-replica)', async () => {
    const fake = new FakeRedis();
    const store = makeStore(fake);
    wireRedisRevocationStore(store);
    // Simulate a revoke that happened on ANOTHER replica (write straight to
    // the shared store, NOT via this façade's local map).
    await store.revoke('jti-remote', FUTURE_EXP_S);
    // The local Map never saw it, but the async path must catch it.
    expect(tokenBlocklist.isRevoked('jti-remote')).toBe(false);
    expect(await tokenBlocklist.isRevokedAsync('jti-remote')).toBe(true);
  });

  it('façade.revoke mirrors to Redis and a mirror failure does not throw', async () => {
    const fake = new FakeRedis();
    fake.failWith = new Error('redis down');
    const store = makeStore(fake);
    wireRedisRevocationStore(store);
    // Must not throw even though the Redis mirror rejects.
    expect(() => tokenBlocklist.revoke('jti-local', FUTURE_EXP_S)).not.toThrow();
    // Local map still holds it (same-replica coverage).
    expect(tokenBlocklist.isRevoked('jti-local')).toBe(true);
  });

  it('degrades to the local map when Redis errors at check time', async () => {
    const fake = new FakeRedis();
    const store = makeStore(fake);
    wireRedisRevocationStore(store);
    // Local revoke succeeds.
    tokenBlocklist.revoke('jti-degraded', FUTURE_EXP_S);
    // Now Redis goes down for the check — façade must still return true from
    // the local map (never fail open for a same-replica revoke).
    fake.failWith = new Error('redis down');
    expect(await tokenBlocklist.isRevokedAsync('jti-degraded')).toBe(true);
    // A jti only revoked remotely (never locally) returns false when Redis
    // is down — availability over a hard 500, with the health flag set.
    expect(await tokenBlocklist.isRevokedAsync('jti-only-remote')).toBe(false);
  });

  it('with no Redis store wired, isRevokedAsync == local isRevoked', async () => {
    tokenBlocklist.revoke('jti-localonly', FUTURE_EXP_S);
    expect(await tokenBlocklist.isRevokedAsync('jti-localonly')).toBe(true);
    expect(await tokenBlocklist.isRevokedAsync('jti-absent')).toBe(false);
  });
});
