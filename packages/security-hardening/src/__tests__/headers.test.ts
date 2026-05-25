import { describe, it, expect } from 'vitest';

import {
  buildSecurityHeaders,
  withRouteOverride,
} from '../headers/presets.js';
import { createSecurityHeadersMiddleware } from '../headers/middleware.js';
import type {
  MiddlewareContext,
  MiddlewareNext,
} from '../headers/middleware.js';

describe('buildSecurityHeaders presets', () => {
  it('production preset sets HSTS + strict CSP + COEP + COOP + CORP', () => {
    const h = buildSecurityHeaders({ env: 'production' });
    expect(h['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(h['Content-Security-Policy']).toContain("default-src 'self'");
    expect(h['Content-Security-Policy']).toContain("script-src 'self'");
    expect(h['Content-Security-Policy']).not.toContain("'unsafe-eval'");
    expect(h['Cross-Origin-Embedder-Policy']).toBe('require-corp');
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(h['Cross-Origin-Resource-Policy']).toBe('same-origin');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Permissions-Policy']).toContain('geolocation=()');
    expect(h['Permissions-Policy']).toContain('camera=()');
    expect(h['Permissions-Policy']).toContain('microphone=()');
  });

  it('development preset skips HSTS + allows unsafe-eval for HMR', () => {
    const h = buildSecurityHeaders({ env: 'development' });
    expect(h['Strict-Transport-Security']).toBeUndefined();
    expect(h['Content-Security-Policy']).toContain("'unsafe-eval'");
    expect(h['Content-Security-Policy']).toContain('ws:');
  });

  it('disableCoep removes the COEP header', () => {
    const h = buildSecurityHeaders({ env: 'production', disableCoep: true });
    expect(h['Cross-Origin-Embedder-Policy']).toBeUndefined();
  });

  it('explicit csp override wins over the preset', () => {
    const custom = "default-src 'none'; img-src https:";
    const h = buildSecurityHeaders({ env: 'production', csp: custom });
    expect(h['Content-Security-Policy']).toBe(custom);
  });

  it('extra headers are merged on top of the preset', () => {
    const h = buildSecurityHeaders({
      env: 'production',
      extra: { 'X-Custom': 'v1' },
    });
    expect(h['X-Custom']).toBe('v1');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
  });
});

describe('withRouteOverride', () => {
  it('does not mutate the base config + deep-merges extras', () => {
    const base = {
      env: 'production' as const,
      extra: { A: '1' },
    };
    const merged = withRouteOverride(base, {
      csp: "default-src 'self' https://stripe.com",
      extra: { B: '2' },
    });
    expect(merged.csp).toContain('stripe.com');
    expect(merged.extra).toEqual({ A: '1', B: '2' });
    // base unchanged (immutability rule)
    expect(base.extra).toEqual({ A: '1' });
  });
});

interface MockCtx extends MiddlewareContext {
  readonly storedHeaders: Map<string, string>;
}

function mockCtx(path = '/'): MockCtx {
  const storedHeaders = new Map<string, string>();
  return {
    storedHeaders,
    res: {
      headers: {
        set(name, value) {
          storedHeaders.set(name, value);
        },
      },
    },
    header(name, value) {
      storedHeaders.set(name, value);
    },
    // attach a minimal `req` so resolvePath finds the path
    ...({ req: { path } } as object),
  } as MockCtx;
}

const noopNext: MiddlewareNext = async () => {};

describe('createSecurityHeadersMiddleware', () => {
  it('sets the preset headers on the response after next()', async () => {
    const mw = createSecurityHeadersMiddleware({ env: 'production' });
    const ctx = mockCtx('/api/v1/properties');
    await mw(ctx, noopNext);
    expect(ctx.storedHeaders.get('X-Frame-Options')).toBe('DENY');
    expect(ctx.storedHeaders.get('Strict-Transport-Security')).toContain(
      'max-age=',
    );
  });

  it('applies a route override (longest-prefix wins)', async () => {
    const mw = createSecurityHeadersMiddleware({
      env: 'production',
      routeOverrides: [
        {
          pathPrefix: '/api',
          override: { extra: { 'X-Scope': 'api' } },
        },
        {
          pathPrefix: '/api/v1/embed',
          override: { extra: { 'X-Scope': 'embed' } },
        },
      ],
    });
    const ctx = mockCtx('/api/v1/embed/widget');
    await mw(ctx, noopNext);
    expect(ctx.storedHeaders.get('X-Scope')).toBe('embed');
  });

  it('falls back to a custom resolvePath when no req.path is present', async () => {
    const mw = createSecurityHeadersMiddleware({
      env: 'production',
      resolvePath: () => '/oauth/callback',
      routeOverrides: [
        {
          pathPrefix: '/oauth',
          override: { extra: { 'X-OAuth': '1' } },
        },
      ],
    });
    const ctx = mockCtx();
    await mw(ctx, noopNext);
    expect(ctx.storedHeaders.get('X-OAuth')).toBe('1');
  });
});
