/**
 * tenant-key-prefix — wraps any Redis-shaped client so that every
 * key is auto-prefixed with `tenant:${tenantId}:` and verified at
 * call time. Calls outside a TenantContext throw.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */

import { getTenantContext } from '../context/tenant-context.js';
import {
  IsolationViolation,
  type TenantId,
} from '../types.js';

export interface RedisLikeClient {
  set(key: string, value: string, ...args: ReadonlyArray<unknown>): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string | ReadonlyArray<string>): Promise<unknown>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  hget(key: string, field: string): Promise<string | null>;
  expire(key: string, ttl: number): Promise<unknown>;
}

const KEY_PREFIX_RX = /^tenant:[A-Za-z0-9_\-]+:/;

/**
 * Build the canonical key for a given tenant + suffix. Use this
 * for any pre-computed key string that crosses async boundaries.
 */
export function tenantKey(tenantId: TenantId, suffix: string): string {
  if (typeof suffix !== 'string' || suffix.length === 0) {
    throw new IsolationViolation({
      layer: 'redis',
      kind: 'unprefixed-key',
      tenantId,
      message: 'tenantKey: suffix must be a non-empty string',
    });
  }
  if (suffix.startsWith('tenant:')) {
    throw new IsolationViolation({
      layer: 'redis',
      kind: 'unprefixed-key',
      tenantId,
      message: 'tenantKey: suffix must not itself start with "tenant:" (double-prefix)',
    });
  }
  return `tenant:${tenantId}:${suffix}`;
}

/**
 * Verify that a key string is correctly tenant-prefixed for the
 * active context. Throws IsolationViolation on mismatch.
 */
export function assertTenantPrefixedKey(key: string): void {
  const ctx = getTenantContext();
  if (!KEY_PREFIX_RX.test(key)) {
    throw new IsolationViolation({
      layer: 'redis',
      kind: 'unprefixed-key',
      tenantId: ctx.tenantId,
      message: `redis key "${key}" is not tenant-prefixed`,
    });
  }
  const expected = `tenant:${ctx.tenantId}:`;
  if (!key.startsWith(expected)) {
    const m = /^tenant:([A-Za-z0-9_\-]+):/.exec(key);
    const observed = (m?.[1] ?? 'unknown') as TenantId;
    throw new IsolationViolation({
      layer: 'redis',
      kind: 'cross-tenant-access',
      tenantId: ctx.tenantId,
      observedTenantId: observed,
      message: `redis key "${key}" has tenant prefix "${observed}" but context is "${ctx.tenantId}"`,
    });
  }
}

/**
 * Wrap a Redis client. Returned object has the same method shape
 * but each call:
 *   - prefixes the key if not already prefixed;
 *   - asserts the resolved key matches the context tenant.
 */
export function wrapRedisWithTenantPrefix(
  client: RedisLikeClient,
): RedisLikeClient {
  const resolve = (key: string): string => {
    if (key.startsWith('tenant:')) {
      assertTenantPrefixedKey(key);
      return key;
    }
    const ctx = getTenantContext();
    return tenantKey(ctx.tenantId, key);
  };

  return {
    set: async (key, value, ...args) => client.set(resolve(key), value, ...args),
    get: async (key) => client.get(resolve(key)),
    del: async (key) => {
      if (Array.isArray(key)) {
        return client.del(key.map(resolve));
      }
      return client.del(resolve(key as string));
    },
    hset: async (key, field, value) => client.hset(resolve(key), field, value),
    hget: async (key, field) => client.hget(resolve(key), field),
    expire: async (key, ttl) => client.expire(resolve(key), ttl),
  };
}
