/**
 * Redis key prefix helpers + thin client wrapper.
 *
 * Every key stored in Redis MUST be prefixed with the tenant id of
 * the writer. This prevents a misconfigured cache lookup from
 * returning another tenant's data.
 *
 * Format: `tenant:<tenantId>:<suffix>`. The `:` separator is reserved;
 * `asTenantId()` rejects any tenant id containing it, so the prefix
 * boundary is unambiguous.
 *
 * Two integration paths:
 *
 *   1. Build keys explicitly with `tenantKey(ctx.tenantId, "foo")`.
 *      Direct and lint-checkable.
 *
 *   2. Wrap the Redis client with `wrapRedisWithTenantPrefix(client)`.
 *      All ops accept either a raw suffix (auto-prefixed using the
 *      current AsyncLocalStorage context) or a pre-prefixed key
 *      (verified to match the current context). Use this for legacy
 *      paths where rewriting every call site is too noisy.
 *
 * Ported verbatim from @litfin/tenant-guard.
 */

import { getTenantContext } from "./context";
import { IsolationViolation, type TenantId } from "./types";

const PREFIX_FOR = (id: TenantId): string => `tenant:${id}:`;

export function tenantKey(tenantId: TenantId, suffix: string): string {
  if (!suffix) {
    throw new IsolationViolation({
      layer: "redis",
      kind: "missing-tenant-prefix",
      expectedTenantId: tenantId,
      hint: "tenantKey suffix must not be empty",
    });
  }
  return `${PREFIX_FOR(tenantId)}${suffix}`;
}

export function assertTenantPrefixedKey(key: string, tenantId: TenantId): void {
  const expected = PREFIX_FOR(tenantId);
  if (!key.startsWith(expected)) {
    throw new IsolationViolation({
      layer: "redis",
      kind: "missing-tenant-prefix",
      observedTenantId: key.split(":")[1] ?? key,
      expectedTenantId: tenantId,
      hint: `redis key "${key.slice(0, 80)}..." missing expected tenant prefix`,
    });
  }
}

/**
 * Minimal Redis surface we wrap. Compatible with `ioredis`,
 * `@upstash/redis`, and node-redis. Methods not declared here
 * pass through unchanged from the wrapped client — callers that
 * need additional ops should also wrap those at their use site
 * using `tenantKey`.
 */
export interface RedisLike {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, ...rest: unknown[]): Promise<unknown>;
  del(key: string | string[]): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  hget?(key: string, field: string): Promise<unknown>;
  hset?(key: string, ...args: unknown[]): Promise<unknown>;
}

function resolve(key: string): string {
  const ctx = getTenantContext();
  if (key.startsWith("tenant:")) {
    assertTenantPrefixedKey(key, ctx.tenantId);
    return key;
  }
  return tenantKey(ctx.tenantId, key);
}

export function wrapRedisWithTenantPrefix<T extends RedisLike>(client: T): T {
  // Capture the original method bindings BEFORE we wrap. Without
  // this, the wrapper that ends up on `client.set` would call
  // itself recursively (Object.assign overwrote the original).
  const orig = {
    get: client.get.bind(client),
    set: client.set.bind(client),
    del: client.del.bind(client),
    expire: client.expire.bind(client),
    hget: client.hget?.bind(client),
    hset: client.hset?.bind(client),
  };
  // Wrap each call in an async function so a sync throw inside
  // `resolve()` surfaces as a rejected promise. Without this, callers
  // using `await client.get(key)` see a synchronous throw, which both
  // breaks `await expect(...).rejects.toBeInstanceOf(...)` test
  // ergonomics and means a stray bad-key call could crash the request
  // before any try/catch downstream has a chance to handle it.
  const wrapped: RedisLike = {
    get: async (key) => orig.get(resolve(key)),
    set: async (key, value, ...rest) => orig.set(resolve(key), value, ...rest),
    del: async (key) => {
      if (Array.isArray(key)) return orig.del(key.map(resolve));
      return orig.del(resolve(key));
    },
    expire: async (key, seconds) => orig.expire(resolve(key), seconds),
    hget: orig.hget
      ? async (key, field) => orig.hget!(resolve(key), field)
      : undefined,
    hset: orig.hset
      ? async (key, ...args) => orig.hset!(resolve(key), ...args)
      : undefined,
  };
  return Object.assign(client, wrapped) as T;
}
