/**
 * Regression suite for the webhook idempotency middleware.
 *
 * Closes audit P3 (`.audit/deep-audit-2026-05-20.md`) — duplicate
 * webhook deliveries must be deduped at the gateway, not corrupt
 * downstream state.
 *
 * The suite exercises the middleware through a real Hono app so the
 * `c.req` + `c.res` + `c.json` plumbing is integration-tested, not
 * stubbed. Redis is faked with an in-process Map that implements the
 * `RedisLike` surface.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import {
  createWebhookIdempotencyMiddleware,
  extractKeyFromHeaders,
  extractKeyFromBodyField,
  buildWebhookKey,
  __internal,
  type RedisLike,
} from '../webhook-idempotency.middleware';

// ---------------------------------------------------------------------------
// Fake Redis — Map-backed, supports PX (millisecond TTL) and an
// optional `failNext` switch so tests can simulate outages.
// ---------------------------------------------------------------------------

interface FakeEntry {
  readonly value: string;
  readonly expiresAt: number;
}

class FakeRedis implements RedisLike {
  private store = new Map<string, FakeEntry>();
  public failGet = false;
  public failSet = false;

  async get(key: string): Promise<string | null> {
    if (this.failGet) throw new Error('redis-down: get');
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    opts?: { PX?: number; EX?: number }
  ): Promise<unknown> {
    if (this.failSet) throw new Error('redis-down: set');
    const ttl = opts?.PX ?? (opts?.EX ?? 60) * 1000;
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
    return 'OK';
  }

  size(): number {
    return this.store.size;
  }

  rawGet(key: string): string | undefined {
    return this.store.get(key)?.value;
  }
}

// ---------------------------------------------------------------------------
// Test app builder — wires a single POST handler that counts how many
// times it's actually executed. Replays should NOT increment the counter.
// ---------------------------------------------------------------------------

interface BuiltApp {
  readonly app: Hono;
  readonly executionsRef: { count: number };
}

function buildApp(opts: {
  redis: RedisLike | null;
  scope?: string;
  extractKey?: (c: Parameters<Parameters<Hono['use']>[1]>[0]) => string | null;
  extractTenantId?: (
    c: Parameters<Parameters<Hono['use']>[1]>[0]
  ) => string | null | Promise<string | null>;
  ttlMs?: number;
  routeBody?: (counter: { count: number }) => Record<string, unknown>;
}): BuiltApp {
  const app = new Hono();
  const executionsRef = { count: 0 };
  const mw = createWebhookIdempotencyMiddleware({
    redis: opts.redis,
    scope: opts.scope ?? 'test',
    extractKey: opts.extractKey ?? extractKeyFromHeaders('idempotency-key'),
    extractTenantId: opts.extractTenantId,
    ttlMs: opts.ttlMs,
  });
  app.use('/hook', mw);
  app.post('/hook', (c) => {
    executionsRef.count += 1;
    const body = opts.routeBody?.(executionsRef) ?? {
      received: true,
      executions: executionsRef.count,
    };
    return c.json(body, 200);
  });
  return { app, executionsRef };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('webhook-idempotency middleware', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
  });

  describe('cache hit/miss', () => {
    it('first call executes; second call with same key replays cached body without re-executing', async () => {
      const { app, executionsRef } = buildApp({ redis });
      const headers = {
        'content-type': 'application/json',
        'idempotency-key': 'msg-abc-123',
      };
      const body = JSON.stringify({ event: 'delivered' });

      const first = await app.request('/hook', { method: 'POST', body, headers });
      expect(first.status).toBe(200);
      const firstJson = (await first.json()) as { executions: number };
      expect(firstJson.executions).toBe(1);
      expect(executionsRef.count).toBe(1);

      const second = await app.request('/hook', { method: 'POST', body, headers });
      expect(second.status).toBe(200);
      const secondJson = (await second.json()) as { executions: number };
      // Cached body, not a fresh execution.
      expect(secondJson.executions).toBe(1);
      expect(executionsRef.count).toBe(1);
      expect(second.headers.get('webhook-idempotent-replay')).toBe('true');
    });

    it('different idempotency keys do NOT collide — each executes independently', async () => {
      const { app, executionsRef } = buildApp({ redis });
      const body = JSON.stringify({ event: 'delivered' });

      const a = await app.request('/hook', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'idempotency-key': 'msg-aaa' },
      });
      const b = await app.request('/hook', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'idempotency-key': 'msg-bbb' },
      });

      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(executionsRef.count).toBe(2);
    });

    it('missing idempotency key passes through (executes; no caching)', async () => {
      const { app, executionsRef } = buildApp({ redis });
      const body = JSON.stringify({ event: 'delivered' });

      const a = await app.request('/hook', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      });
      const b = await app.request('/hook', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      });

      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(executionsRef.count).toBe(2);
      expect(redis.size()).toBe(0);
    });

    it('non-mutation methods bypass the middleware entirely', async () => {
      const app = new Hono();
      app.use(
        '/hook',
        createWebhookIdempotencyMiddleware({
          redis,
          scope: 'test',
          extractKey: extractKeyFromHeaders('idempotency-key'),
        })
      );
      app.get('/hook', (c) => c.json({ ok: true }));

      const res = await app.request('/hook', {
        method: 'GET',
        headers: { 'idempotency-key': 'should-be-ignored' },
      });
      expect(res.status).toBe(200);
      expect(redis.size()).toBe(0);
    });

    it('does NOT cache 4xx/5xx responses — provider can retry', async () => {
      const app = new Hono();
      const executions = { count: 0 };
      app.use(
        '/hook',
        createWebhookIdempotencyMiddleware({
          redis,
          scope: 'test',
          extractKey: extractKeyFromHeaders('idempotency-key'),
        })
      );
      app.post('/hook', (c) => {
        executions.count += 1;
        return c.json({ error: 'bad' }, 400);
      });

      const headers = {
        'content-type': 'application/json',
        'idempotency-key': 'retry-me',
      };
      const first = await app.request('/hook', {
        method: 'POST',
        body: '{}',
        headers,
      });
      const second = await app.request('/hook', {
        method: 'POST',
        body: '{}',
        headers,
      });
      expect(first.status).toBe(400);
      expect(second.status).toBe(400);
      expect(executions.count).toBe(2);
      expect(redis.size()).toBe(0);
    });
  });

  describe('Redis-down behaviour — fails LOUD with 503', () => {
    it('returns 503 when Redis client is null', async () => {
      const { app, executionsRef } = buildApp({ redis: null });
      const res = await app.request('/hook', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'k' },
      });
      expect(res.status).toBe(503);
      const json = (await res.json()) as { error?: { code?: string; reason?: string } };
      expect(json.error?.code).toBe('WEBHOOK_IDEMPOTENCY_UNAVAILABLE');
      expect(json.error?.reason).toBe('no-redis');
      expect(executionsRef.count).toBe(0);
    });

    it('returns 503 when redis.get throws', async () => {
      redis.failGet = true;
      const { app, executionsRef } = buildApp({ redis });
      const res = await app.request('/hook', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'k' },
      });
      expect(res.status).toBe(503);
      const json = (await res.json()) as { error?: { code?: string; reason?: string } };
      expect(json.error?.code).toBe('WEBHOOK_IDEMPOTENCY_UNAVAILABLE');
      expect(json.error?.reason).toBe('lookup-failed');
      expect(executionsRef.count).toBe(0);
    });
  });

  describe('tenant scoping', () => {
    it('different tenants with same idempotency key do NOT collide', async () => {
      const { app, executionsRef } = buildApp({
        redis,
        extractTenantId: (c) => c.req.header('x-tenant-id') ?? null,
      });
      const body = JSON.stringify({ event: 'delivered' });

      const tenantA = await app.request('/hook', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'shared-key',
          'x-tenant-id': 'tenant-A',
        },
      });
      const tenantB = await app.request('/hook', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'shared-key',
          'x-tenant-id': 'tenant-B',
        },
      });

      expect(tenantA.status).toBe(200);
      expect(tenantB.status).toBe(200);
      // Both executed — tenant scoping kept them apart.
      expect(executionsRef.count).toBe(2);

      // Replay each — neither should re-execute.
      const replayA = await app.request('/hook', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'shared-key',
          'x-tenant-id': 'tenant-A',
        },
      });
      expect(replayA.status).toBe(200);
      expect(replayA.headers.get('webhook-idempotent-replay')).toBe('true');
      expect(executionsRef.count).toBe(2);
    });

    it('buildWebhookKey produces collision-free keys across scopes/tenants', () => {
      expect(buildWebhookKey('twilio', 't1', 'k1')).toBe('webhook:twilio:t1:k1');
      expect(buildWebhookKey('twilio', 't2', 'k1')).toBe('webhook:twilio:t2:k1');
      expect(buildWebhookKey('meta', 't1', 'k1')).toBe('webhook:meta:t1:k1');
      expect(buildWebhookKey('twilio', null, 'k1')).toBe('webhook:twilio:anon:k1');
    });
  });

  describe('key extractors', () => {
    it('extractKeyFromHeaders picks the first non-empty header in priority order', async () => {
      const { app, executionsRef } = buildApp({
        redis,
        extractKey: extractKeyFromHeaders(
          'x-twilio-idempotency-token',
          'idempotency-key'
        ),
      });
      const body = '{}';

      const twilio = await app.request('/hook', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'x-twilio-idempotency-token': 'twilio-k',
          'idempotency-key': 'generic-k',
        },
      });
      expect(twilio.status).toBe(200);

      // Replay using ONLY twilio header → still hits cache (key matched
      // by priority order, not by which header is present).
      const replay = await app.request('/hook', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'x-twilio-idempotency-token': 'twilio-k',
        },
      });
      expect(replay.headers.get('webhook-idempotent-replay')).toBe('true');
      expect(executionsRef.count).toBe(1);
    });

    it('extractKeyFromBodyField pulls a dotted path from the JSON body without consuming the stream', async () => {
      const app = new Hono();
      const executions = { count: 0 };
      const seenBodies: string[] = [];

      app.use(
        '/hook',
        createWebhookIdempotencyMiddleware({
          redis,
          scope: 'inngest',
          extractKey: extractKeyFromBodyField('id'),
        })
      );
      app.post('/hook', async (c) => {
        // The route handler must still see the original body — verifies
        // the extractor cloned correctly.
        const raw = await c.req.raw.text();
        seenBodies.push(raw);
        executions.count += 1;
        return c.json({ ok: true }, 200);
      });

      const body = JSON.stringify({ id: 'evt-xyz', name: 'something' });
      const first = await app.request('/hook', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      });
      expect(first.status).toBe(200);
      expect(executions.count).toBe(1);
      expect(seenBodies[0]).toBe(body);

      const second = await app.request('/hook', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      });
      expect(second.status).toBe(200);
      expect(second.headers.get('webhook-idempotent-replay')).toBe('true');
      expect(executions.count).toBe(1);
    });

    it('extractKeyFromBodyField returns null for malformed JSON — middleware skips caching', async () => {
      const { app, executionsRef } = buildApp({
        redis,
        extractKey: extractKeyFromBodyField('id'),
      });
      const headers = { 'content-type': 'application/json' };

      const a = await app.request('/hook', {
        method: 'POST',
        body: 'not-json',
        headers,
      });
      const b = await app.request('/hook', {
        method: 'POST',
        body: 'not-json',
        headers,
      });
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      // No key extracted → both execute.
      expect(executionsRef.count).toBe(2);
      expect(redis.size()).toBe(0);
    });
  });

  describe('key validation', () => {
    it('rejects keys with disallowed characters — treats as no-key', async () => {
      const { app, executionsRef } = buildApp({ redis });
      // `$` is a legal HTTP header byte but our zod regex
      // intentionally rejects it — only [A-Za-z0-9_\-.] are permitted
      // so we never feed surprising bytes to Redis or downstream logs.
      // Note: `:` and `/` were ALSO rejected in the post-audit hardening
      // because they collide with our `webhook:scope:tenant:key` separator
      // (see middleware JSDoc).
      const a = await app.request('/hook', {
        method: 'POST',
        body: '{}',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'bad$key',
        },
      });
      expect(a.status).toBe(200);
      expect(executionsRef.count).toBe(1);
      // Nothing cached because the key was rejected.
      expect(redis.size()).toBe(0);
    });

    it('rejects keys containing `:` or `/` — collide with Redis key separator', async () => {
      const { app, executionsRef } = buildApp({ redis });
      const colonKey = await app.request('/hook', {
        method: 'POST',
        body: '{}',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'tenant:foo:bar',
        },
      });
      expect(colonKey.status).toBe(200);
      const slashKey = await app.request('/hook', {
        method: 'POST',
        body: '{}',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'a/b/c',
        },
      });
      expect(slashKey.status).toBe(200);
      // Both treated as no-key → both executed, neither cached.
      expect(executionsRef.count).toBe(2);
      expect(redis.size()).toBe(0);
    });

    it('rejects oversized keys — treats as no-key', async () => {
      const { app, executionsRef } = buildApp({ redis });
      const huge = 'x'.repeat(500);
      const res = await app.request('/hook', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json', 'idempotency-key': huge },
      });
      expect(res.status).toBe(200);
      expect(executionsRef.count).toBe(1);
      expect(redis.size()).toBe(0);
    });
  });

  describe('observability', () => {
    it('logs (not throws) when redis.set fails after handler success', async () => {
      const errorSpy = vi.fn();
      const app = new Hono();
      const fake = new FakeRedis();
      fake.failSet = true;
      app.use(
        '/hook',
        createWebhookIdempotencyMiddleware({
          redis: fake,
          scope: 'test',
          extractKey: extractKeyFromHeaders('idempotency-key'),
          logger: { error: errorSpy },
        })
      );
      app.post('/hook', (c) => c.json({ ok: true }, 200));

      const res = await app.request('/hook', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'k' },
      });
      // Handler already succeeded — we cannot 503 here. Just log.
      expect(res.status).toBe(200);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('response-header replay allowlist (CRITICAL audit fix)', () => {
    it('does NOT replay Set-Cookie / Location / CORS headers on cache hit', async () => {
      const app = new Hono();
      const executions = { count: 0 };
      app.use(
        '/hook',
        createWebhookIdempotencyMiddleware({
          redis,
          scope: 'test',
          extractKey: extractKeyFromHeaders('idempotency-key'),
        })
      );
      app.post('/hook', (c) => {
        executions.count += 1;
        // Set a bunch of headers the handler might emit. Only those in
        // the allowlist should survive the replay round-trip.
        c.header('set-cookie', 'session=abc; HttpOnly');
        c.header('location', 'https://attacker.example.com/');
        c.header('access-control-allow-origin', '*');
        c.header('access-control-allow-credentials', 'true');
        c.header('x-request-id', 'req-xyz');
        c.header('x-custom-header', 'leaked-secret');
        return c.json({ ok: true }, 200);
      });
      const headers = {
        'content-type': 'application/json',
        'idempotency-key': 'header-allowlist',
      };

      // First request — handler runs, emits all headers, cache populated
      // with only the allowlisted ones.
      const first = await app.request('/hook', { method: 'POST', body: '{}', headers });
      expect(first.status).toBe(200);
      expect(executions.count).toBe(1);
      // First request DOES legitimately emit Set-Cookie/Location/etc.
      // — we only filter on replay. Sanity-check that handler is wired.
      expect(first.headers.get('set-cookie')).toBeTruthy();

      // Second request — replay. Forbidden headers must be DROPPED.
      const replay = await app.request('/hook', { method: 'POST', body: '{}', headers });
      expect(replay.status).toBe(200);
      expect(executions.count).toBe(1);
      expect(replay.headers.get('webhook-idempotent-replay')).toBe('true');
      // Allowlisted survivors:
      expect(replay.headers.get('content-type')).toMatch(/application\/json/);
      expect(replay.headers.get('x-request-id')).toBe('req-xyz');
      // Forbidden — must be absent on replay:
      expect(replay.headers.get('set-cookie')).toBeNull();
      expect(replay.headers.get('location')).toBeNull();
      expect(replay.headers.get('access-control-allow-origin')).toBeNull();
      expect(replay.headers.get('access-control-allow-credentials')).toBeNull();
      expect(replay.headers.get('x-custom-header')).toBeNull();
    });

    it('exposes the allowlist via __internal for external auditors', () => {
      const allow = __internal.REPLAY_ALLOW_HEADERS;
      expect(allow.has('content-type')).toBe(true);
      expect(allow.has('x-request-id')).toBe(true);
      expect(allow.has('webhook-idempotent-replay')).toBe(true);
      expect(allow.has('set-cookie')).toBe(false);
      expect(allow.has('location')).toBe(false);
    });
  });
});
