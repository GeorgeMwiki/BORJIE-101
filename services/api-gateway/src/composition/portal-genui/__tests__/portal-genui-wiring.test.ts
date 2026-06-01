/**
 * Portal-GenUI wiring tests (seam #2 — the engine is constructed + exposed).
 *
 * In the test env neither DATABASE_URL nor ANTHROPIC_API_KEY is set, so the
 * builder constructs the engine in degraded mode (in-memory registry +
 * heuristic-only intent + deterministic generator) and returns it together
 * with the router for the orchestrator to mount. We assert:
 *
 *   - buildPortalGenuiWiring() returns a usable { engine, router }.
 *   - the engine works end-to-end (detect → generate) without DB/LLM, which
 *     is exactly what the router's /detect + /generate routes drive.
 *   - the returned router is the same Hono app the orchestrator mounts at
 *     /api/v1/portal-genui (it 503s when no engine is on the registry, proving
 *     it's the genuine portal-genui router).
 */

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';
delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;

import { describe, it, expect } from 'vitest';

import { buildPortalGenuiWiring } from '../portal-genui-wiring.js';

describe('buildPortalGenuiWiring', () => {
  it('returns a constructed engine + a router', () => {
    const wiring = buildPortalGenuiWiring();
    expect(wiring.engine).toBeDefined();
    expect(typeof wiring.engine.detectIntent).toBe('function');
    expect(typeof wiring.engine.generate).toBe('function');
    expect(wiring.router).toBeDefined();
    // No DATABASE_URL in test → in-memory persistence (not durable).
    expect(wiring.persistent).toBe(false);
  });

  it('the engine detects + generates without a DB or LLM (degraded mode)', async () => {
    const { engine } = buildPortalGenuiWiring();
    const intent = await engine.detectIntent({
      message: 'we need to track our staff payroll',
    });
    expect(intent?.domain).toBe('hr');
    const result = await engine.generate({
      intent: intent!,
      tenantId: 'tenant_A',
      userId: 'user_1',
      actorId: 'user_1',
    });
    expect(result.tab.domain).toBe('hr');
    expect(result.tab.sections.length).toBeGreaterThan(0);
  });

  it('the returned router is the portal-genui router (503 without an engine)', async () => {
    const { router } = buildPortalGenuiWiring();
    // Mount bare (no services on the ctx) — the router must 503 with the
    // engine-missing code, confirming it reads services.portalGenUIEngine.
    const { Hono } = await import('hono');
    const app = new Hono();
    app.route('/portal-genui', router);
    const { generateToken } = await import('../../../middleware/auth.js');
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ??
      'test-secret-jwt-0123456789abcdef0123456789abcdef';
    const token = generateToken({
      userId: 'user_1',
      tenantId: 'tenant_A',
      role: 'super_admin' as never,
      permissions: [],
      propertyAccess: ['*'],
    });
    const res = await app.request('/portal-genui/detect', {
      method: 'POST',
      body: JSON.stringify({ message: 'hi' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PORTAL_GENUI_ENGINE_MISSING');
  });
});
