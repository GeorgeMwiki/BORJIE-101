/**
 * Tests for the Redis key-prefix wrapper.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  tenantKey,
  assertTenantPrefixedKey,
  wrapRedisWithTenantPrefix,
  type RedisLikeClient,
} from '../redis/tenant-key-prefix.js';
import { runInTenantContext } from '../context/tenant-context.js';
import { asTenantId, IsolationViolation, type TenantContext, type TenantId } from '../types.js';

function makeCtx(t: string): TenantContext {
  const tid = asTenantId(t) as TenantId;
  return { tenantId: tid, actorTenantId: tid, requestId: 'req_redis_test' };
}

function makeStub(): { spy: ReturnType<typeof vi.fn>; client: RedisLikeClient } {
  const spy = vi.fn().mockResolvedValue('OK');
  const client: RedisLikeClient = {
    set: (k, v, ...rest) => spy('set', k, v, ...rest),
    get: (k) => spy('get', k),
    del: (k) => spy('del', k),
    hset: (k, f, v) => spy('hset', k, f, v),
    hget: (k, f) => spy('hget', k, f),
    expire: (k, ttl) => spy('expire', k, ttl),
  };
  return { spy, client };
}

describe('tenant-key-prefix', () => {
  it('tenantKey builds canonical tenant-prefixed key', () => {
    const t = asTenantId('tenant_alpha') as TenantId;
    expect(tenantKey(t, 'profile:42')).toBe('tenant:tenant_alpha:profile:42');
  });

  it('tenantKey rejects empty suffix', () => {
    const t = asTenantId('tenant_alpha') as TenantId;
    expect(() => tenantKey(t, '')).toThrowError(IsolationViolation);
  });

  it('tenantKey rejects double-prefix suffix', () => {
    const t = asTenantId('tenant_alpha') as TenantId;
    expect(() => tenantKey(t, 'tenant:foo')).toThrowError(IsolationViolation);
  });

  it('assertTenantPrefixedKey throws on cross-tenant key', async () => {
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, () => {
      expect(() => assertTenantPrefixedKey('tenant:tenant_beta:foo')).toThrowError(
        IsolationViolation,
      );
    });
  });

  it('wrapped redis client auto-prefixes unprefixed keys', async () => {
    const { spy, client } = makeStub();
    const wrapped = wrapRedisWithTenantPrefix(client);
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, async () => {
      await wrapped.set('foo', 'bar');
    });
    expect(spy).toHaveBeenCalledWith('set', 'tenant:tenant_alpha:foo', 'bar');
  });

  it('wrapped redis client rejects cross-tenant prefixed keys', async () => {
    const { client } = makeStub();
    const wrapped = wrapRedisWithTenantPrefix(client);
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, async () => {
      await expect(wrapped.set('tenant:tenant_beta:foo', 'x')).rejects.toBeInstanceOf(
        IsolationViolation,
      );
    });
  });
});
