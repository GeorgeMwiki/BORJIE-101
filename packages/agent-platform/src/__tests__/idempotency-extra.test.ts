/**
 * Extra tests for idempotency.ts — TTL expiry, non-idempotent methods,
 * cross-agent isolation, and the in-memory store contract.
 */
import { describe, expect, it } from 'vitest';
import {
  cacheIdempotencyResponse,
  checkIdempotency,
  createInMemoryIdempotencyStore,
} from '../idempotency.js';

describe('createInMemoryIdempotencyStore', () => {
  it('isolates records by agent id', async () => {
    const store = createInMemoryIdempotencyStore();
    await store.put({
      key: 'k1',
      agentId: 'a',
      method: 'POST',
      path: '/x',
      requestHash: 'h',
      statusCode: 200,
      responseBody: 'A',
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2099-01-01T00:00:00Z',
    });
    await store.put({
      key: 'k1',
      agentId: 'b',
      method: 'POST',
      path: '/x',
      requestHash: 'h',
      statusCode: 200,
      responseBody: 'B',
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2099-01-01T00:00:00Z',
    });

    const a = await store.find('k1', 'a');
    const b = await store.find('k1', 'b');
    expect(a?.responseBody).toBe('A');
    expect(b?.responseBody).toBe('B');
  });

  it('delete removes only the specified (key,agent) pair', async () => {
    const store = createInMemoryIdempotencyStore();
    await store.put({
      key: 'k',
      agentId: 'a',
      method: 'POST',
      path: '/x',
      requestHash: 'h',
      statusCode: 200,
      responseBody: 'r',
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2099-01-01T00:00:00Z',
    });
    await store.delete('k', 'a');
    expect(await store.find('k', 'a')).toBeNull();
  });
});

describe('checkIdempotency', () => {
  it('returns fresh for DELETE method even with key', async () => {
    const store = createInMemoryIdempotencyStore();
    const r = await checkIdempotency({
      store,
      method: 'DELETE',
      headers: { 'x-idempotency-key': 'k' },
      body: '{}',
      agentId: 'a',
    });
    expect(r.kind).toBe('fresh');
  });

  it('returns fresh when no idempotency key present (POST)', async () => {
    const store = createInMemoryIdempotencyStore();
    const r = await checkIdempotency({
      store,
      method: 'POST',
      headers: {},
      body: '{}',
      agentId: 'a',
    });
    expect(r.kind).toBe('fresh');
  });

  it('uppercases the method (lowercase put → put → PUT path)', async () => {
    const store = createInMemoryIdempotencyStore();
    const r = await checkIdempotency({
      store,
      method: 'put',
      headers: { 'x-idempotency-key': 'k' },
      body: '{}',
      agentId: 'a',
    });
    expect(r.kind).toBe('fresh');
    if (r.kind === 'fresh') expect(r.idempotencyKey).toBe('k');
  });

  it('treats expired records as fresh and deletes them', async () => {
    const store = createInMemoryIdempotencyStore();
    // Pre-populate with a record that's already expired.
    await store.put({
      key: 'k',
      agentId: 'a',
      method: 'POST',
      path: '/x',
      requestHash: 'irrelevant',
      statusCode: 200,
      responseBody: 'old',
      createdAt: '2020-01-01T00:00:00Z',
      expiresAt: '2020-01-02T00:00:00Z',
    });
    const r = await checkIdempotency({
      store,
      method: 'POST',
      headers: { 'x-idempotency-key': 'k' },
      body: '{}',
      agentId: 'a',
      now: () => new Date('2026-05-08').getTime(),
    });
    expect(r.kind).toBe('fresh');
    // The check should have deleted the stale record.
    expect(await store.find('k', 'a')).toBeNull();
  });

  it('records share keys across agents but are isolated', async () => {
    const store = createInMemoryIdempotencyStore();
    const first = await checkIdempotency({
      store,
      method: 'POST',
      headers: { 'x-idempotency-key': 'shared' },
      body: '{"x":1}',
      agentId: 'a',
    });
    expect(first.kind).toBe('fresh');
    if (first.kind === 'fresh') {
      await cacheIdempotencyResponse({
        store,
        idempotencyKey: 'shared',
        agentId: 'a',
        method: 'POST',
        path: '/x',
        requestHash: first.requestHash!,
        statusCode: 201,
        responseBody: '{"id":"a"}',
      });
    }
    // Different agent uses the same key — must NOT replay.
    const otherAgent = await checkIdempotency({
      store,
      method: 'POST',
      headers: { 'x-idempotency-key': 'shared' },
      body: '{"x":1}',
      agentId: 'b',
    });
    expect(otherAgent.kind).toBe('fresh');
  });
});

describe('cacheIdempotencyResponse', () => {
  it('caches 2xx responses', async () => {
    const store = createInMemoryIdempotencyStore();
    await cacheIdempotencyResponse({
      store,
      idempotencyKey: 'k',
      agentId: 'a',
      method: 'POST',
      path: '/x',
      requestHash: 'h',
      statusCode: 201,
      responseBody: '{}',
    });
    const r = await store.find('k', 'a');
    expect(r).not.toBeNull();
    expect(r?.statusCode).toBe(201);
  });

  it('skips caching for 3xx redirects', async () => {
    const store = createInMemoryIdempotencyStore();
    await cacheIdempotencyResponse({
      store,
      idempotencyKey: 'k',
      agentId: 'a',
      method: 'POST',
      path: '/x',
      requestHash: 'h',
      statusCode: 301,
      responseBody: '',
    });
    expect(await store.find('k', 'a')).toBeNull();
  });

  it('skips caching for 4xx and 5xx responses', async () => {
    const store = createInMemoryIdempotencyStore();
    await cacheIdempotencyResponse({
      store,
      idempotencyKey: 'k',
      agentId: 'a',
      method: 'POST',
      path: '/x',
      requestHash: 'h',
      statusCode: 400,
      responseBody: '',
    });
    expect(await store.find('k', 'a')).toBeNull();
    await cacheIdempotencyResponse({
      store,
      idempotencyKey: 'k2',
      agentId: 'a',
      method: 'POST',
      path: '/x',
      requestHash: 'h',
      statusCode: 503,
      responseBody: '',
    });
    expect(await store.find('k2', 'a')).toBeNull();
  });

  it('records expiry 24h after createdAt by default', async () => {
    const store = createInMemoryIdempotencyStore();
    const fixedNow = Date.parse('2026-05-08T12:00:00Z');
    await cacheIdempotencyResponse({
      store,
      idempotencyKey: 'k',
      agentId: 'a',
      method: 'POST',
      path: '/x',
      requestHash: 'h',
      statusCode: 200,
      responseBody: '{}',
      now: () => fixedNow,
    });
    const rec = await store.find('k', 'a');
    expect(rec).not.toBeNull();
    if (rec) {
      const created = new Date(rec.createdAt).getTime();
      const expires = new Date(rec.expiresAt).getTime();
      expect(expires - created).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('uppercases the method on the cached record', async () => {
    const store = createInMemoryIdempotencyStore();
    await cacheIdempotencyResponse({
      store,
      idempotencyKey: 'k',
      agentId: 'a',
      method: 'patch',
      path: '/x',
      requestHash: 'h',
      statusCode: 200,
      responseBody: '{}',
    });
    const rec = await store.find('k', 'a');
    expect(rec?.method).toBe('PATCH');
  });
});
