/**
 * Tests for the Hono tenant-context middleware.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  honoTenantMiddleware,
  type HonoLike,
  type DecodedJwt,
} from '../middleware/hono-tenant-middleware.js';
import { tryGetTenantContext } from '../context/tenant-context.js';

function makeCtx(jwt: DecodedJwt | null): HonoLike & { state: Map<string, unknown>; lastJson?: { body: unknown; status: number } } {
  const state = new Map<string, unknown>();
  const headers = new Map<string, string>();
  const c: HonoLike & { state: Map<string, unknown>; lastJson?: { body: unknown; status: number } } = {
    state,
    req: {
      header: (n: string) => headers.get(n.toLowerCase()),
      raw: { headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null } },
    },
    get: (k: string) => state.get(k),
    set: (k: string, v: unknown) => {
      state.set(k, v);
    },
    json: (body: unknown, status: number) => {
      c.lastJson = { body, status };
      return new Response(JSON.stringify(body), { status });
    },
  };
  if (jwt) state.set('decodedJwt', jwt);
  return c;
}

describe('honoTenantMiddleware', () => {
  it('binds tenant context when JWT carries a valid tenant_id', async () => {
    const jwt: DecodedJwt = { app_metadata: { tenant_id: 'tenant_alpha' } };
    const c = makeCtx(jwt);
    const mw = honoTenantMiddleware({ resolveJwt: async () => jwt });
    const next = vi.fn(async () => {
      const ctx = tryGetTenantContext();
      expect(ctx?.tenantId).toBe('tenant_alpha');
    });
    await mw(c, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects requests with no JWT (401)', async () => {
    const c = makeCtx(null);
    const mw = honoTenantMiddleware({ resolveJwt: async () => null });
    const next = vi.fn();
    await mw(c, next);
    expect(c.lastJson?.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests where tenant_id claim is missing', async () => {
    const jwt: DecodedJwt = { app_metadata: {} };
    const c = makeCtx(jwt);
    const mw = honoTenantMiddleware({ resolveJwt: async () => jwt });
    const next = vi.fn();
    await mw(c, next);
    expect(c.lastJson?.status).toBe(401);
  });

  it('rejects malformed tenant claims (whitespace / colons)', async () => {
    const jwt: DecodedJwt = { app_metadata: { tenant_id: 'has space' } };
    const c = makeCtx(jwt);
    const mw = honoTenantMiddleware({ resolveJwt: async () => jwt });
    const next = vi.fn();
    await mw(c, next);
    expect(c.lastJson?.status).toBe(401);
  });
});
