import { describe, expect, it } from 'vitest';
import { computeETag, createETagCache } from '../cache/etag-cache.js';

describe('computeETag', () => {
  it('produces a weak etag with W/ prefix', () => {
    expect(computeETag({ a: 1 })).toMatch(/^W\/"[a-z0-9]+"$/);
  });

  it('returns the same etag for the same input', () => {
    expect(computeETag({ a: 1, b: 2 })).toBe(computeETag({ a: 1, b: 2 }));
  });

  it('returns different etags for different inputs', () => {
    expect(computeETag({ a: 1 })).not.toBe(computeETag({ a: 2 }));
  });
});

describe('createETagCache', () => {
  it('responds with 200 when If-None-Match is absent', async () => {
    const cache = createETagCache<{ header(n: string): string | undefined }>({
      keyer: () => 'k',
    });
    const req = { header: () => undefined };
    const out = await cache.handle({
      req,
      value: { hello: 'world' },
      responder: (etag) => ({ status: 200, etag }),
      notModifiedResponder: () => ({ status: 304 }),
    });
    expect(out).toEqual({ status: 200, etag: expect.stringMatching(/^W\//) });
  });

  it('responds with 304 when If-None-Match equals computed etag', async () => {
    const value = { hello: 'world' };
    const expected = computeETag(value);
    const cache = createETagCache<{ header(n: string): string | undefined }>({
      keyer: () => 'k',
    });
    const req = { header: (n: string) => (n === 'If-None-Match' ? expected : undefined) };
    const out = await cache.handle({
      req,
      value,
      responder: () => ({ status: 200 }),
      notModifiedResponder: (etag) => ({ status: 304, etag }),
    });
    expect(out).toEqual({ status: 304, etag: expected });
  });

  it('uses custom If-None-Match reader when provided', async () => {
    const value = 'payload';
    const expected = computeETag(value);
    const cache = createETagCache<{ inm?: string }>({
      keyer: () => 'k',
    });
    const out = await cache.handle({
      req: { inm: expected },
      value,
      responder: () => 'OK' as const,
      notModifiedResponder: () => 'NOT-MOD' as const,
      readIfNoneMatch: (r) => r.inm,
    });
    expect(out).toBe('NOT-MOD');
  });
});
