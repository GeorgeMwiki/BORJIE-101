/**
 * Tenant-context middleware unit tests.
 *
 * DA1 MEDIUM coverage: `extractTenantId` must validate every code path
 * (auth, header, subdomain, query) — never return an unvalidated string.
 * The Host-header subdomain branch in particular is fully attacker-
 * controlled at the L7 boundary, so an un-validated value would let
 * traversal sequences or oversized strings flow into downstream fetch
 * URLs (SSRF).
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { extractTenantId, isValidTenantId } from '../tenant-context.middleware';

// Tiny harness — mount a probe route that echoes the result of
// `extractTenantId` back to the test so we can drive it via `app.request`.
function makeProbeApp(): Hono {
  const app = new Hono();
  app.get('/probe', (c) => {
    const result = extractTenantId(c);
    return c.json({ tenantId: result });
  });
  return app;
}

describe('extractTenantId — auth context branch', () => {
  it('returns the tenantId from auth context when valid', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as never, { tenantId: 'tnt-123', userId: 'u1', role: 'ADMIN' } as never);
      await next();
    });
    app.get('/probe', (c) => c.json({ tenantId: extractTenantId(c) }));

    const res = await app.request('/probe');
    const body = (await res.json()) as { tenantId: string | null };
    expect(body.tenantId).toBe('tnt-123');
  });

  it('rejects an invalid auth-context tenantId (defence-in-depth)', async () => {
    // An attacker-influenced JWT claim must still be validated. The
    // regex bounds the character set + length so traversal-style
    // payloads bypass downstream routing logic.
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as never, { tenantId: '../admin', userId: 'u1', role: 'X' } as never);
      await next();
    });
    app.get('/probe', (c) => c.json({ tenantId: extractTenantId(c) }));

    const res = await app.request('/probe');
    const body = (await res.json()) as { tenantId: string | null };
    expect(body.tenantId).toBeNull();
  });
});

describe('extractTenantId — header branch', () => {
  it('returns a valid X-Tenant-ID header value', async () => {
    const app = makeProbeApp();
    const res = await app.request('/probe', {
      headers: { 'X-Tenant-ID': 'tnt_abc-1' },
    });
    const body = (await res.json()) as { tenantId: string | null };
    expect(body.tenantId).toBe('tnt_abc-1');
  });

  it('rejects an X-Tenant-ID header containing path traversal', async () => {
    const app = makeProbeApp();
    const res = await app.request('/probe', {
      headers: { 'X-Tenant-ID': '../../admin/keys' },
    });
    const body = (await res.json()) as { tenantId: string | null };
    expect(body.tenantId).toBeNull();
  });

  it('rejects an oversized X-Tenant-ID header value', async () => {
    const app = makeProbeApp();
    const longId = 'a'.repeat(200);
    const res = await app.request('/probe', {
      headers: { 'X-Tenant-ID': longId },
    });
    const body = (await res.json()) as { tenantId: string | null };
    expect(body.tenantId).toBeNull();
  });
});

describe('extractTenantId — subdomain branch (DA1 MEDIUM)', () => {
  it('returns a valid subdomain as the tenantId', async () => {
    // DA1 fix: the subdomain branch must run isValidTenantId before
    // returning the value, not rely on a downstream re-check.
    const app = makeProbeApp();
    const res = await app.request('/probe', {
      headers: { Host: 'acme.borjie.com' },
    });
    const body = (await res.json()) as { tenantId: string | null };
    expect(body.tenantId).toBe('acme');
  });

  it('skips the "www" and "api" subdomains', async () => {
    const app = makeProbeApp();
    for (const sub of ['www', 'api']) {
      const res = await app.request('/probe', {
        headers: { Host: `${sub}.borjie.com` },
      });
      const body = (await res.json()) as { tenantId: string | null };
      expect(body.tenantId).toBeNull();
    }
  });

  it('rejects a subdomain that looks like a path-traversal attempt', async () => {
    // SSRF surface: the Host header is fully attacker-controlled. An
    // un-validated `parts[0]` would let a value like `../admin` (yes,
    // dots are technically illegal in subdomains but L7 ingress
    // controllers may forward whatever the client sends) flow downstream
    // into `loadTenantFromDatabase`'s fetch URL.
    //
    // We can't actually inject literal `..` into a DNS label, but the
    // bug class also covers oversized / non-alphanum subdomains.
    const app = makeProbeApp();
    const malicious = 'x'.repeat(200); // > 64 chars → fails regex
    const res = await app.request('/probe', {
      headers: { Host: `${malicious}.borjie.com` },
    });
    const body = (await res.json()) as { tenantId: string | null };
    expect(body.tenantId).toBeNull();
  });

  it('returns null when host has fewer than 3 segments', async () => {
    const app = makeProbeApp();
    const res = await app.request('/probe', {
      headers: { Host: 'borjie.com' },
    });
    const body = (await res.json()) as { tenantId: string | null };
    expect(body.tenantId).toBeNull();
  });
});

describe('extractTenantId — query param branch (dev only)', () => {
  it('rejects an invalid query tenantId in development', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      const app = makeProbeApp();
      const res = await app.request('/probe?tenantId=../etc/passwd');
      const body = (await res.json()) as { tenantId: string | null };
      expect(body.tenantId).toBeNull();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('accepts a valid query tenantId in development', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      const app = makeProbeApp();
      const res = await app.request('/probe?tenantId=dev-tenant');
      const body = (await res.json()) as { tenantId: string | null };
      expect(body.tenantId).toBe('dev-tenant');
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('ignores the query param in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const app = makeProbeApp();
      const res = await app.request('/probe?tenantId=prod-tenant');
      const body = (await res.json()) as { tenantId: string | null };
      expect(body.tenantId).toBeNull();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});

describe('isValidTenantId — regex bounds', () => {
  it('accepts valid IDs (alphanumeric + dash + underscore, 1-64 chars)', () => {
    for (const v of ['tnt-1', 'tnt_a', 'ABC123', 'a', 'a'.repeat(64)]) {
      expect(isValidTenantId(v)).toBe(true);
    }
  });

  it('rejects path traversal, special chars, oversized, and wrong types', () => {
    for (const v of [
      '',
      '../admin',
      'tnt/123',
      'tnt 123',
      'tnt.123',
      'a'.repeat(65),
      123,
      null,
      undefined,
      {},
    ]) {
      expect(isValidTenantId(v)).toBe(false);
    }
  });
});
