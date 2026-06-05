/**
 * Persona-registry router tests — Phase D D7.
 *
 * Covers two execution paths:
 *
 *   DEGRADED — `services.personaRegistry` is null → GET / returns
 *   HTTP 503 with error.code === 'NOT_IMPLEMENTED'.
 *
 *   LIVE — inject a real kernel PersonaRegistry (hydrated from an
 *   in-memory store) → GET / returns HTTP 200, success:true, data is
 *   the persona list.
 *
 * Auth is bypassed via vi.doMock('../../middleware/hono-auth') so the
 * test does not depend on JWT-secret module-init ordering (see the
 * sovereign-ledger router test for the established pattern in this
 * codebase). The router's role-gate is NOT weakened — the mock
 * supplies a no-op pass-through that mimics an already-authenticated
 * SUPER_ADMIN so the role check in the live handler is satisfied.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Hono } from 'hono';

// Pin the JWT secret before any imports so middlewares that capture
// the secret at module init agree. Not strictly needed here (auth is
// mocked) but keeps the file consistent with sibling test files.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { createPersonaRegistry, createInMemoryPersonaRegistryStore } from '@borjie/central-intelligence';
import { UserRole } from '../../types/user-role.js';

/** Middleware factory that injects a service bag into context. */
function attachServices(services: Record<string, unknown>) {
  return async (c: ReturnType<typeof Hono.prototype.request> extends Promise<Response> ? never : Parameters<Parameters<Hono['use']>[1]>[0], next: () => Promise<void>) => {
    (c as { set: (k: string, v: unknown) => void }).set('services', services);
    await next();
  };
}

/** Auth bypass that pre-sets the auth context, skipping JWT verification. */
function bypassAuth(role: string) {
  return async (c: Parameters<Parameters<Hono['use']>[1]>[0], next: () => Promise<void>) => {
    (c as { set: (k: string, v: unknown) => void }).set('auth', {
      userId: `user-${role.toLowerCase()}`,
      tenantId: 'tenant-test',
      role,
      permissions: ['*'],
      propertyAccess: ['*'],
    });
    await next();
  };
}

describe('persona-registry router — DEGRADED mode (null slot)', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('GET / returns 503 NOT_IMPLEMENTED when personaRegistry is null', async () => {
    vi.resetModules();
    vi.doMock('../../middleware/hono-auth', () => ({
      authMiddleware: bypassAuth(UserRole.SUPER_ADMIN),
      requireRole: () => async (_c: unknown, next: () => Promise<void>) => { await next(); },
    }));

    const mod = await import('../persona-registry.router');
    const router = (mod as { default: Hono }).default;
    const app = new Hono();
    app.use('*', attachServices({ personaRegistry: null }));
    app.route('/', router);

    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_IMPLEMENTED');

    vi.doUnmock('../../middleware/hono-auth');
    vi.resetModules();
  });

  it('GET / returns 503 NOT_IMPLEMENTED when services is undefined (no middleware)', async () => {
    vi.resetModules();
    vi.doMock('../../middleware/hono-auth', () => ({
      authMiddleware: bypassAuth(UserRole.ADMIN),
      requireRole: () => async (_c: unknown, next: () => Promise<void>) => { await next(); },
    }));

    const mod = await import('../persona-registry.router');
    const router = (mod as { default: Hono }).default;
    const app = new Hono();
    // Intentionally no services injected — slot resolves to undefined.
    app.route('/', router);

    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_IMPLEMENTED');

    vi.doUnmock('../../middleware/hono-auth');
    vi.resetModules();
  });
});

describe('persona-registry router — LIVE mode (real kernel registry)', () => {
  it('GET / returns 200 success:true with persona list when registry is wired', async () => {
    vi.resetModules();
    vi.doMock('../../middleware/hono-auth', () => ({
      authMiddleware: bypassAuth(UserRole.SUPER_ADMIN),
      requireRole: () => async (_c: unknown, next: () => Promise<void>) => { await next(); },
    }));

    // Build a real kernel PersonaRegistry backed by an in-memory store
    // seeded with one persona so the list is non-empty.
    const seedPersona = {
      id: 'mr-mwikila',
      displayName: 'Mr. Mwikila',
      openingStatement: 'Habari ya leo?',
      toneGuidance: 'Professional, warm, direct.',
      taboos: ['hedging language'],
      violationSignals: ['not sure', 'maybe'],
      firstPersonNoun: 'I',
    };
    const store = createInMemoryPersonaRegistryStore([seedPersona]);
    const personaRegistry = await createPersonaRegistry({ store });

    const mod = await import('../persona-registry.router');
    const router = (mod as { default: Hono }).default;
    const app = new Hono();
    app.use('*', attachServices({ personaRegistry }));
    app.route('/', router);

    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Array<{ id: string; displayName: string }>;
    };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.data[0]?.id).toBe('mr-mwikila');
    expect(body.data[0]?.displayName).toBe('Mr. Mwikila');

    vi.doUnmock('../../middleware/hono-auth');
    vi.resetModules();
  });
});
