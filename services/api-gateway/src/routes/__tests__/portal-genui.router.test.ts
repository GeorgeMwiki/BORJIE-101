/**
 * portal-genui router tests.
 *
 * Two layers:
 *
 *   1. Auth gates — anonymous requests bounce with 401 (matches the
 *      acquisition-advisor / expansion-advisor pattern).
 *   2. Happy-path with a real signed JWT + an in-memory genUI engine
 *      injected via `c.set('services', {portalGenUIEngine: ...})`
 *      ahead of the router's auth middleware.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { createGenUIEngine } from '@borjie/portal-genui';
import portalGenUIRouter from '../portal-genui/portal-genui.router.js';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';

function bareApp(): Hono {
  const app = new Hono();
  app.route('/portal-genui', portalGenUIRouter);
  return app;
}

function appWithEngine(): {
  readonly app: Hono;
  readonly engine: ReturnType<typeof createGenUIEngine>;
} {
  const engine = createGenUIEngine();
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', { portalGenUIEngine: engine } as never);
    await next();
  });
  app.route('/portal-genui', portalGenUIRouter);
  return { app, engine };
}

function bearer(opts: {
  userId?: string;
  tenantId?: string;
  role?: UserRole;
} = {}): string {
  return `Bearer ${generateToken({
    userId: opts.userId ?? 'user_1',
    tenantId: opts.tenantId ?? 'tenant_1',
    role: (opts.role ?? UserRole.SUPER_ADMIN) as never,
    permissions: [],
    propertyAccess: ['*'],
  })}`;
}

describe('portal-genui router — JWT env', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });
});

// ────────────────────────────────────────────────────────────────────
// Auth gates
// ────────────────────────────────────────────────────────────────────

describe('portal-genui router — auth gates', () => {
  it('rejects POST /detect without a token', async () => {
    const res = await bareApp().request('/portal-genui/detect', {
      method: 'POST',
      body: JSON.stringify({ message: 'hi' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST /generate without a token', async () => {
    const res = await bareApp().request('/portal-genui/generate', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST /tabs without a token', async () => {
    const res = await bareApp().request('/portal-genui/tabs', {
      method: 'POST',
      body: JSON.stringify({ tab: {} }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects GET /tabs without a token', async () => {
    const res = await bareApp().request('/portal-genui/tabs');
    expect(res.status).toBe(401);
  });

  it('rejects GET /tabs/:id without a token', async () => {
    const res = await bareApp().request('/portal-genui/tabs/abc');
    expect(res.status).toBe(401);
  });

  it('rejects DELETE /tabs/:id without a token', async () => {
    const res = await bareApp().request('/portal-genui/tabs/abc', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('rejects with an invalid bearer token', async () => {
    const res = await bareApp().request('/portal-genui/detect', {
      method: 'POST',
      body: JSON.stringify({ message: 'hi' }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer not-a-real-jwt',
      },
    });
    expect(res.status).toBe(401);
  });
});

// ────────────────────────────────────────────────────────────────────
// Happy paths
// ────────────────────────────────────────────────────────────────────

describe('portal-genui router — POST /detect', () => {
  it('classifies an HR intent', async () => {
    const { app } = appWithEngine();
    const res = await app.request('/portal-genui/detect', {
      method: 'POST',
      body: JSON.stringify({ message: 'we need to track our staff payroll' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { intent: { domain: string } | null };
    };
    expect(body.success).toBe(true);
    expect(body.data.intent?.domain).toBe('hr');
  });

  it('returns null intent for a greeting', async () => {
    const { app } = appWithEngine();
    const res = await app.request('/portal-genui/detect', {
      method: 'POST',
      body: JSON.stringify({ message: 'hello there' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { intent: unknown } };
    expect(body.data.intent).toBeNull();
  });

  it('rejects invalid body shape with 400', async () => {
    const { app } = appWithEngine();
    const res = await app.request('/portal-genui/detect', {
      method: 'POST',
      body: JSON.stringify({ wrongField: 'x' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON with 400', async () => {
    const { app } = appWithEngine();
    const res = await app.request('/portal-genui/detect', {
      method: 'POST',
      body: '{not json',
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(400);
  });
});

describe('portal-genui router — POST /generate', () => {
  it('generates a tab from a valid intent', async () => {
    const { app } = appWithEngine();
    const intent = {
      proposedTabKey: 'hr.payroll',
      proposedTabTitle: 'Payroll',
      domain: 'hr',
      confidence: 0.8,
      evidence: ['payroll'],
      sourceMessage: 'we need to track our staff payroll',
      usedLlm: false,
    };
    const res = await app.request('/portal-genui/generate', {
      method: 'POST',
      body: JSON.stringify({ intent }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { tab: { domain: string }; persisted: boolean };
    };
    expect(body.data.tab.domain).toBe('hr');
    expect(body.data.persisted).toBe(false);
  });

  it('persists when persist=true', async () => {
    const { app, engine } = appWithEngine();
    const intent = {
      proposedTabKey: 'finance.budgets',
      proposedTabTitle: 'Budgets',
      domain: 'finance',
      confidence: 0.8,
      evidence: ['budgets'],
      sourceMessage: 'we need to manage our budgets',
      usedLlm: false,
    };
    const res = await app.request('/portal-genui/generate', {
      method: 'POST',
      body: JSON.stringify({ intent, persist: true }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(200);
    const tabs = await engine.list({
      tenantId: 'tenant_1',
      userId: 'user_1',
    });
    expect(tabs.length).toBe(1);
  });

  it('rejects invalid intent shape with 400', async () => {
    const { app } = appWithEngine();
    const res = await app.request('/portal-genui/generate', {
      method: 'POST',
      body: JSON.stringify({ intent: { invalid: true } }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(400);
  });
});

describe('portal-genui router — tabs CRUD', () => {
  it('POST /tabs persists a tab and returns 201', async () => {
    const { app, engine } = appWithEngine();
    const intent = (await engine.detectIntent({
      message: 'we need to track our staff payroll',
    }))!;
    const gen = await engine.generate({
      intent,
      tenantId: 'tenant_1',
      userId: 'user_1',
      actorId: 'user_1',
    });
    const res = await app.request('/portal-genui/tabs', {
      method: 'POST',
      body: JSON.stringify({ tab: gen.tab }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe(gen.tab.id);
  });

  it('POST /tabs returns 409 on tab_key conflict', async () => {
    const { app, engine } = appWithEngine();
    const intent = (await engine.detectIntent({
      message: 'we need to track our supplier onboarding',
    }))!;
    const first = await engine.generate({
      intent,
      tenantId: 'tenant_1',
      userId: 'user_1',
      actorId: 'user_1',
    });
    await engine.persist({ tab: first.tab });
    // Now POST a second tab with the same key via the route — should 409.
    const second = await engine.generate({
      intent,
      tenantId: 'tenant_1',
      userId: 'user_1',
      actorId: 'user_1',
    });
    const res = await app.request('/portal-genui/tabs', {
      method: 'POST',
      body: JSON.stringify({ tab: second.tab }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(409);
  });

  it('GET /tabs lists per (tenant, user)', async () => {
    const { app, engine } = appWithEngine();
    const intent = (await engine.detectIntent({
      message: 'we need to track our supplier onboarding',
    }))!;
    const gen = await engine.generate({
      intent,
      tenantId: 'tenant_1',
      userId: 'user_1',
      actorId: 'user_1',
    });
    await engine.persist({ tab: gen.tab });
    const res = await app.request('/portal-genui/tabs?userId=user_1', {
      headers: { authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { tabs: unknown[] } };
    expect(body.data.tabs.length).toBe(1);
  });

  it('GET /tabs/:id returns the tab', async () => {
    const { app, engine } = appWithEngine();
    const intent = (await engine.detectIntent({
      message: 'we need to track our supplier onboarding',
    }))!;
    const gen = await engine.generate({
      intent,
      tenantId: 'tenant_1',
      userId: 'user_1',
      actorId: 'user_1',
    });
    await engine.persist({ tab: gen.tab });
    const res = await app.request(`/portal-genui/tabs/${gen.tab.id}`, {
      headers: { authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { tab: { id: string } } };
    expect(body.data.tab.id).toBe(gen.tab.id);
  });

  it('GET /tabs/:id 404 on unknown id', async () => {
    const { app } = appWithEngine();
    const res = await app.request('/portal-genui/tabs/missing', {
      headers: { authorization: bearer() },
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /tabs/:id removes the tab', async () => {
    const { app, engine } = appWithEngine();
    const intent = (await engine.detectIntent({
      message: 'we need to track our supplier onboarding',
    }))!;
    const gen = await engine.generate({
      intent,
      tenantId: 'tenant_1',
      userId: 'user_1',
      actorId: 'user_1',
    });
    await engine.persist({ tab: gen.tab });
    const del = await app.request(`/portal-genui/tabs/${gen.tab.id}`, {
      method: 'DELETE',
      headers: { authorization: bearer() },
    });
    expect(del.status).toBe(200);
    const after = await app.request(`/portal-genui/tabs/${gen.tab.id}`, {
      headers: { authorization: bearer() },
    });
    expect(after.status).toBe(404);
  });

  it('DELETE /tabs/:id 404 when nothing deleted', async () => {
    const { app } = appWithEngine();
    const del = await app.request('/portal-genui/tabs/missing', {
      method: 'DELETE',
      headers: { authorization: bearer() },
    });
    expect(del.status).toBe(404);
  });
});

describe('portal-genui router — engine missing', () => {
  it('returns 503 when no engine is wired', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('services', {} as never); // no engine
      await next();
    });
    app.route('/portal-genui', portalGenUIRouter);
    const res = await app.request('/portal-genui/detect', {
      method: 'POST',
      body: JSON.stringify({ message: 'hi' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PORTAL_GENUI_ENGINE_MISSING');
  });
});
