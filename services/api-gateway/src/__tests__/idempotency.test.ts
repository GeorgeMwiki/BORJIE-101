/**
 * Idempotency in-memory store — cache hit behavior (SCAFFOLDED 10)
 *
 * Also covers CRITICAL-7 regression: the middleware MUST NOT honour an
 * `x-tenant-id` header fallback when the verified auth context is
 * missing. The fallback let a caller poison another tenant's cache by
 * naming any victim tenant in the header.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createInMemoryIdempotencyStore,
  createIdempotencyMiddleware,
  type CachedResponse,
  type IdempotencyStore,
} from '../middleware/idempotency.js';

describe('createInMemoryIdempotencyStore', () => {
  it('returns undefined when key missing', async () => {
    const store = createInMemoryIdempotencyStore();
    const got = await store.get('missing');
    expect(got).toBeUndefined();
  });

  it('returns the cached value within TTL', async () => {
    const store = createInMemoryIdempotencyStore();
    const entry: CachedResponse = {
      status: 201,
      body: { ok: true },
      headers: { 'content-type': 'application/json' },
      cachedAt: Date.now(),
    };
    await store.set('k1', entry, 1000);
    const got = await store.get('k1');
    expect(got).toEqual(entry);
  });

  it('expires entries past TTL', async () => {
    const store = createInMemoryIdempotencyStore();
    await store.set('k2', { status: 200, body: {}, headers: {}, cachedAt: 0 }, 0);
    // TTL 0 → immediately expired on next get (we use Date.now() >= expiresAt)
    const got = await store.get('k2');
    expect(got).toBeUndefined();
  });
});

describe('createIdempotencyMiddleware (CRITICAL-7)', () => {
  function makeStore(): IdempotencyStore & {
    setCalls: Array<{ key: string }>;
    getCalls: Array<string>;
  } {
    const setCalls: Array<{ key: string }> = [];
    const getCalls: Array<string> = [];
    return {
      setCalls,
      getCalls,
      async get(key) {
        getCalls.push(key);
        return undefined;
      },
      async set(key) {
        setCalls.push({ key });
      },
    };
  }

  // Minimal Context mock — only the methods the middleware uses.
  function makeCtx(opts: {
    method: string;
    idempotencyKey?: string;
    authTenantId?: string;
    xTenantIdHeader?: string;
  }) {
    const headers: Record<string, string> = {};
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    if (opts.xTenantIdHeader) headers['x-tenant-id'] = opts.xTenantIdHeader;
    const ctxVars: Record<string, unknown> = {};
    if (opts.authTenantId) ctxVars.auth = { tenantId: opts.authTenantId };
    return {
      req: {
        method: opts.method,
        header: (name: string) => headers[name.toLowerCase()],
      },
      get: (k: string) => ctxVars[k],
      header: () => undefined,
      res: { status: 200, clone: () => ({ text: async () => '', headers: { forEach: () => undefined } }) },
      json: vi.fn().mockReturnValue('JSON_RESPONSE'),
    };
  }

  it('refuses to cache when only x-tenant-id header is present (no auth)', async () => {
    const store = makeStore();
    const mw = createIdempotencyMiddleware({ store });
    const ctx = makeCtx({
      method: 'POST',
      idempotencyKey: 'idem_attacker',
      xTenantIdHeader: 'tenant_victim',
    });
    let nextCalled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await mw(ctx as any, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    // CRITICAL-7: NO cache lookup or write was performed for the
    // attacker-supplied tenantId.
    expect(store.getCalls).toEqual([]);
    expect(store.setCalls).toEqual([]);
  });

  it('caches when auth.tenantId is present (verified context)', async () => {
    const store = makeStore();
    const mw = createIdempotencyMiddleware({ store });
    const ctx = makeCtx({
      method: 'POST',
      idempotencyKey: 'idem_real',
      authTenantId: 'tenant_real',
    });
    let nextCalled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await mw(ctx as any, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    // The cache key namespace MUST come from the verified tenant.
    expect(store.getCalls[0]).toBe('idem:tenant_real:idem_real');
  });
});
