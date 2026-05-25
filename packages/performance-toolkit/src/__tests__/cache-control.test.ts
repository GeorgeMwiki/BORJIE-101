import { describe, expect, it } from 'vitest';
import {
  applyCacheControl,
  expressCacheControl,
  honoCacheControl,
} from '../cache/cache-control.js';

describe('applyCacheControl presets', () => {
  it('public-immutable: 1-year + immutable', () => {
    const p = applyCacheControl('public-immutable');
    expect(p.cacheControl).toContain('public');
    expect(p.cacheControl).toContain('max-age=31536000');
    expect(p.cacheControl).toContain('immutable');
  });

  it('public-swr: max-age + stale-while-revalidate', () => {
    const p = applyCacheControl('public-swr');
    expect(p.cacheControl).toContain('max-age=60');
    expect(p.cacheControl).toContain('stale-while-revalidate');
  });

  it('private-no-store: no-store + must-revalidate (money path)', () => {
    const p = applyCacheControl('private-no-store');
    expect(p.cacheControl).toContain('private');
    expect(p.cacheControl).toContain('no-store');
    expect(p.cacheControl).toContain('must-revalidate');
    expect(p.vary).toContain('Authorization');
  });

  it('edge-cdn: s-maxage > max-age + SWR', () => {
    const p = applyCacheControl('edge-cdn');
    expect(p.cacheControl).toContain('s-maxage=300');
    expect(p.cacheControl).toContain('stale-while-revalidate');
  });

  it('private-revalidate: no-cache + must-revalidate', () => {
    const p = applyCacheControl('private-revalidate');
    expect(p.cacheControl).toContain('no-cache');
    expect(p.cacheControl).toContain('must-revalidate');
  });
});

describe('honoCacheControl middleware', () => {
  it('sets Cache-Control + Vary headers after next()', async () => {
    const headers = new Map<string, string>();
    const mw = honoCacheControl('public-swr');
    await mw(
      {
        req: { path: '/api/v1/properties' },
        header: (k: string, v: string) => headers.set(k, v),
      },
      async () => {},
    );
    expect(headers.get('Cache-Control')).toBe(applyCacheControl('public-swr').cacheControl);
    expect(headers.get('Vary')).toBe(applyCacheControl('public-swr').vary);
  });

  it('supports per-route strategy via function form', async () => {
    const headers = new Map<string, string>();
    const mw = honoCacheControl((req) =>
      req.path?.startsWith('/api/v1/payments') ? 'private-no-store' : 'public-swr',
    );
    await mw(
      {
        req: { path: '/api/v1/payments' },
        header: (k: string, v: string) => headers.set(k, v),
      },
      async () => {},
    );
    expect(headers.get('Cache-Control')).toContain('no-store');
  });
});

describe('expressCacheControl middleware', () => {
  it('sets headers + calls next', () => {
    const setHeader = (key: string, value: string): void => {
      headers.set(key, value);
    };
    const headers = new Map<string, string>();
    let calledNext = false;
    expressCacheControl('public-swr')(
      {},
      { setHeader },
      () => {
        calledNext = true;
      },
    );
    expect(calledNext).toBe(true);
    expect(headers.get('Cache-Control')).toContain('stale-while-revalidate');
  });
});
