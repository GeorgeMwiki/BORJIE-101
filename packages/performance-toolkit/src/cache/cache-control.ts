/**
 * `applyCacheControl` — preset Cache-Control + Vary header strings for
 * the common SaaS strategies. Use the named presets so every endpoint
 * has a documented, audited cache stance.
 *
 *   - `public-immutable`  : long-lived static (hashed asset names, fonts).
 *                           `max-age=31536000, immutable`
 *   - `public-swr`        : public read-many endpoints (org listings).
 *                           `public, max-age=60, stale-while-revalidate=600`
 *   - `private-no-store`  : sensitive (financials, KYC, audit, money path).
 *                           `private, no-store, no-cache, must-revalidate`
 *   - `edge-cdn`          : CDN-cached, browser private.
 *                           `private, max-age=0, s-maxage=300, stale-while-revalidate=600`
 *   - `private-revalidate`: per-user data; must-revalidate every request.
 *                           `private, no-cache`
 *
 * Source: RFC 7234, RFC 5861 (SWR), Vercel + Cloudflare + Fastly docs.
 */

import type { CacheControlPreset, CacheStrategy } from '../types.js';

const PRESETS: Record<CacheStrategy, CacheControlPreset> = {
  'public-immutable': {
    cacheControl: 'public, max-age=31536000, immutable',
    vary: 'Accept-Encoding',
  },
  'public-swr': {
    cacheControl: 'public, max-age=60, stale-while-revalidate=600',
    vary: 'Accept-Encoding, Accept-Language',
  },
  'private-no-store': {
    cacheControl: 'private, no-store, no-cache, must-revalidate, max-age=0',
    vary: 'Authorization',
  },
  'edge-cdn': {
    cacheControl:
      'private, max-age=0, s-maxage=300, stale-while-revalidate=600',
    vary: 'Accept-Encoding, Authorization',
  },
  'private-revalidate': {
    cacheControl: 'private, no-cache, must-revalidate',
    vary: 'Authorization',
  },
};

/** Return the preset header strings for a strategy. */
export function applyCacheControl(strategy: CacheStrategy): CacheControlPreset {
  return PRESETS[strategy];
}

/**
 * Hono middleware variant — sets the headers on the outgoing response
 * after the inner handler runs. Strategy can be a static value or a
 * function of the request.
 */
export function honoCacheControl(
  strategy: CacheStrategy | ((req: { path?: string; url?: string }) => CacheStrategy),
) {
  return async function cacheControlMiddleware(
    c: {
      req: { path?: string; url?: string };
      header(name: string, value: string): void;
    },
    next: () => Promise<void>,
  ): Promise<void> {
    await next();
    const resolved = typeof strategy === 'function' ? strategy(c.req) : strategy;
    const preset = PRESETS[resolved];
    c.header('Cache-Control', preset.cacheControl);
    c.header('Vary', preset.vary);
  };
}

/**
 * Express middleware variant — same idea for the legacy Express path
 * we still mount in api-gateway/index.ts.
 */
export function expressCacheControl(strategy: CacheStrategy) {
  const preset = PRESETS[strategy];
  return function expressCacheMiddleware(
    _req: unknown,
    res: { setHeader(name: string, value: string): void },
    next: () => void,
  ): void {
    res.setHeader('Cache-Control', preset.cacheControl);
    res.setHeader('Vary', preset.vary);
    next();
  };
}
