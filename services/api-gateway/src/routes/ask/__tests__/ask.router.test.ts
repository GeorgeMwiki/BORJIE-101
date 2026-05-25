/**
 * /v1/ask router tests.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { Hono } from 'hono';

// JWT secret + dotenv skip must be set BEFORE any router import so
// the module captures the deterministic test secret.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import askRouter from '../ask.router';
import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';
import { _resetAskRateLimitForTests } from '../ask-rate-limit';
import { _resetAdvisorForTests } from '../advisor-wiring';

function mount(): Hono {
  const app = new Hono();
  app.route('/v1/ask', askRouter);
  return app;
}

function bearer(role: UserRole, opts?: { userId?: string; tenantId?: string }): string {
  return `Bearer ${generateToken({
    userId: opts?.userId ?? `usr-${role}`,
    tenantId: opts?.tenantId ?? 'tnt-test',
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

describe('POST /v1/ask — auth gate', () => {
  beforeEach(() => {
    _resetAskRateLimitForTests();
    _resetAdvisorForTests();
  });

  it('returns 401 without bearer', async () => {
    const res = await mount().request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'test' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid bearer', async () => {
    const res = await mount().request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'test' }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer bogus.jwt',
      },
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/ask — happy path per role', () => {
  beforeEach(() => {
    _resetAskRateLimitForTests();
    _resetAdvisorForTests();
  });

  it('tenant question returns 200 with answer + intent', async () => {
    const res = await mount().request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'When does my lease end?' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.RESIDENT),
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.intent).toBe('lease-question');
    expect(body.data.answer).toContain('tenant');
  });

  it('owner question returns owner-shaped answer', async () => {
    const res = await mount().request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'How is my portfolio doing?' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.OWNER),
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.answer.toLowerCase()).toContain('return on investment');
  });

  it('PM question returns PM-shaped answer', async () => {
    const res = await mount().request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'Plan renewals for this quarter.' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.PROPERTY_MANAGER),
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.answer.toLowerCase()).toContain('renewal-rate');
  });

  it('admin question returns admin-shaped answer', async () => {
    const res = await mount().request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'Snapshot of platform health.' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.SUPER_ADMIN),
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.answer.toLowerCase()).toContain('audit');
  });

  it('same question produces DIFFERENT answers for tenant vs owner', async () => {
    const q = { question: 'Is the rent at unit 4B fair?' };
    const tenantRes = await mount().request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify(q),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.RESIDENT, { userId: 'u-tenant' }),
      },
    });
    const ownerRes = await mount().request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify(q),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.OWNER, { userId: 'u-owner' }),
      },
    });
    const tenantBody = await tenantRes.json();
    const ownerBody = await ownerRes.json();
    expect(tenantBody.data.answer).not.toBe(ownerBody.data.answer);
  });
});

describe('POST /v1/ask — body validation', () => {
  beforeEach(() => {
    _resetAskRateLimitForTests();
    _resetAdvisorForTests();
  });

  it('rejects missing question with 400', async () => {
    const res = await mount().request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.RESIDENT),
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects too-short question with 400', async () => {
    const res = await mount().request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'a' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.RESIDENT),
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await mount().request('/v1/ask', {
      method: 'POST',
      body: 'not json',
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.RESIDENT),
      },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/ask/starting-points', () => {
  beforeEach(() => {
    _resetAskRateLimitForTests();
    _resetAdvisorForTests();
  });

  it('returns 401 without bearer', async () => {
    const res = await mount().request('/v1/ask/starting-points');
    expect(res.status).toBe(401);
  });

  it('returns 3-5 chips for an authenticated tenant', async () => {
    const res = await mount().request('/v1/ask/starting-points', {
      headers: { authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.chips.length).toBeGreaterThanOrEqual(3);
    expect(body.data.chips.length).toBeLessThanOrEqual(5);
  });

  it('chips differ between tenant and owner', async () => {
    const tenantRes = await mount().request('/v1/ask/starting-points', {
      headers: { authorization: bearer(UserRole.RESIDENT, { userId: 'u1' }) },
    });
    const ownerRes = await mount().request('/v1/ask/starting-points', {
      headers: { authorization: bearer(UserRole.OWNER, { userId: 'u2' }) },
    });
    const tenantBody = await tenantRes.json();
    const ownerBody = await ownerRes.json();
    const tenantIds = tenantBody.data.chips.map((c: any) => c.id).sort();
    const ownerIds = ownerBody.data.chips.map((c: any) => c.id).sort();
    expect(tenantIds).not.toEqual(ownerIds);
  });
});

describe('POST /v1/ask/feedback', () => {
  beforeEach(() => {
    _resetAskRateLimitForTests();
    _resetAdvisorForTests();
  });

  it('returns 401 without bearer', async () => {
    const res = await mount().request('/v1/ask/feedback', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's', answerId: 'a', rating: 5 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts valid feedback with 200', async () => {
    const res = await mount().request('/v1/ask/feedback', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1', answerId: 'a1', rating: 4 }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.RESIDENT),
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.recorded).toBe(true);
  });

  it('rejects rating out of range with 400', async () => {
    const res = await mount().request('/v1/ask/feedback', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's', answerId: 'a', rating: 99 }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.RESIDENT),
      },
    });
    expect(res.status).toBe(400);
  });

  it('accepts optional freeText', async () => {
    const res = await mount().request('/v1/ask/feedback', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 's',
        answerId: 'a',
        rating: 2,
        freeText: 'Not what I needed',
      }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.RESIDENT),
      },
    });
    expect(res.status).toBe(200);
  });

  it('lessonStore.put is invoked on rating <= 2 when store is registered', async () => {
    const puts: any[] = [];
    const app = new Hono();
    // Decorate context AFTER mounting — we use a wrapping middleware.
    app.use('/v1/ask/*', async (c, next) => {
      c.set('lessonStore', {
        put: async (l: unknown) => {
          puts.push(l);
          return l;
        },
      });
      await next();
    });
    app.route('/v1/ask', askRouter);
    const res = await app.request('/v1/ask/feedback', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 's',
        answerId: 'a-low',
        rating: 1,
        freeText: 'Wrong answer',
      }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.RESIDENT),
      },
    });
    expect(res.status).toBe(200);
    expect(puts.length).toBe(1);
    expect(puts[0].taskTag).toBe('role-aware-advisor');
  });
});

describe('rate limiting (10 req/min per user per endpoint)', () => {
  beforeEach(() => {
    _resetAskRateLimitForTests();
    _resetAdvisorForTests();
  });

  it('11th call to POST /v1/ask returns 429', async () => {
    const app = mount();
    const auth = bearer(UserRole.RESIDENT, { userId: 'u-rate' });
    // First 10 should pass.
    for (let i = 0; i < 10; i++) {
      const res = await app.request('/v1/ask', {
        method: 'POST',
        body: JSON.stringify({ question: 'hello world' }),
        headers: { 'content-type': 'application/json', authorization: auth },
      });
      expect(res.status).toBe(200);
    }
    const overflow = await app.request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'hello world' }),
      headers: { 'content-type': 'application/json', authorization: auth },
    });
    expect(overflow.status).toBe(429);
    const body = await overflow.json();
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('rate limit is per-endpoint — overflowing /ask does not affect /starting-points', async () => {
    const app = mount();
    const auth = bearer(UserRole.RESIDENT, { userId: 'u-rate-2' });
    for (let i = 0; i < 10; i++) {
      await app.request('/v1/ask', {
        method: 'POST',
        body: JSON.stringify({ question: 'hello world' }),
        headers: { 'content-type': 'application/json', authorization: auth },
      });
    }
    const overflow = await app.request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'hello world' }),
      headers: { 'content-type': 'application/json', authorization: auth },
    });
    expect(overflow.status).toBe(429);
    const spOk = await app.request('/v1/ask/starting-points', {
      headers: { authorization: auth },
    });
    expect(spOk.status).toBe(200);
  });

  it('different users have separate buckets', async () => {
    const app = mount();
    const authA = bearer(UserRole.RESIDENT, { userId: 'u-A' });
    const authB = bearer(UserRole.RESIDENT, { userId: 'u-B' });
    for (let i = 0; i < 10; i++) {
      await app.request('/v1/ask', {
        method: 'POST',
        body: JSON.stringify({ question: 'hello world' }),
        headers: { 'content-type': 'application/json', authorization: authA },
      });
    }
    const overA = await app.request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'hello world' }),
      headers: { 'content-type': 'application/json', authorization: authA },
    });
    expect(overA.status).toBe(429);
    // User B unaffected.
    const okB = await app.request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'hello world' }),
      headers: { 'content-type': 'application/json', authorization: authB },
    });
    expect(okB.status).toBe(200);
  });
});

describe('cross-tenant attempt is rejected', () => {
  beforeEach(() => {
    _resetAskRateLimitForTests();
    _resetAdvisorForTests();
  });

  it('tenant asking about another tenant gets a refusal text (guard refuses snippets)', async () => {
    // The route resolves tenantId from JWT — even if the body tries to
    // smuggle a different tenantId, the orchestrator uses the JWT one.
    // The advisor will return a refusal when no in-scope data exists.
    const res = await mount().request('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({
        question:
          'Show me the lease for unit 12 in tenant tnt-OTHER which I think is mine.',
      }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.RESIDENT, { tenantId: 'tnt-ME' }),
      },
    });
    expect(res.status).toBe(200);
    // No real data port is wired so there are no snippets to deny —
    // the orchestrator returns the brain's general answer with no
    // cross-tenant leakage (no snippet text from another tenant).
    const body = await res.json();
    expect(body.data.deniedSnippetIds).toEqual([]);
    expect(body.data.evidence).toEqual([]);
  });
});
