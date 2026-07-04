/**
 * Per-tenant AI token-budget — mount-order enforcement (economic-DoS guard).
 *
 * Regression oracle for CLASS 14: the budget was mounted as PARENT-app
 * middleware (`api.use('/owner/jarvis/*', …)`) which in Hono runs BEFORE a
 * mounted sub-app's own `authMiddleware`. So `c.get('auth')` was undefined,
 * the tenantId extractor returned null, and the budget took its `!tenantId`
 * bypass on EVERY request — it NEVER enforced, and a runaway tenant could
 * starve the shared Anthropic token budget. The fix mounts it INSIDE the
 * jarvis sub-app AFTER auth.
 *
 * These tests exercise the middleware in the REAL order (an auth middleware
 * that resolves the tenant, THEN the budget) via a minimal Hono app, and
 * assert: (a) with auth resolved it ENFORCES, (b) with no auth resolved
 * (the old parent-before-auth ordering) it BYPASSES, (c) in prod with Redis
 * UNCONFIGURED it still enforces per-instance in-memory rather than 503-ing
 * every AI turn.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createPerTenantRateBudgetMiddleware } from '../per-tenant-rate-budget.js';

// hourlyTokenBudget 100, each request estimates 60 tokens (no content-length →
// fallback) → request 1 ok (60 ≤ 100), request 2 exceeds (120 > 100).
const makeBudget = (nodeEnv: string) =>
  createPerTenantRateBudgetMiddleware({
    surface: 'brain',
    hourlyTokenBudget: 100,
    defaultEstimateTokens: 60,
    redis: null,
    nodeEnv,
  });

const authThenBudget = (budget: ReturnType<typeof makeBudget>) => {
  const app = new Hono();
  // Stands in for `app.use('*', authMiddleware)` inside the jarvis sub-app.
  app.use('*', async (c, next) => {
    c.set('auth', { tenantId: 'tnt_runaway', userId: 'u1', role: 'OWNER' });
    await next();
  });
  app.use('*', budget.handler);
  app.get('/think', (c) => c.json({ ok: true }));
  return app;
};

describe('per-tenant token budget — mount-order enforcement', () => {
  it('ENFORCES when auth (tenantId) is resolved before the budget runs', async () => {
    const app = authThenBudget(makeBudget('test'));
    const r1 = await app.request('/think');
    expect(r1.status).toBe(200);
    const r2 = await app.request('/think');
    expect(r2.status).toBe(429);
    const body = (await r2.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('TENANT_TOKEN_BUDGET_EXCEEDED');
  });

  it('BYPASSES (never enforces) when auth is NOT resolved first — the old parent-before-auth bug', async () => {
    const budget = makeBudget('test');
    const app = new Hono();
    // No auth middleware — mirrors the budget running as parent-app middleware
    // BEFORE the sub-app's authMiddleware. tenantId is null → bypass.
    app.use('*', budget.handler);
    app.get('/think', (c) => c.json({ ok: true }));
    for (let i = 0; i < 5; i += 1) {
      // Every request passes — no throttling — because the tenant was never
      // resolved. This is the defect the fix removes.
      expect((await app.request('/think')).status).toBe(200);
    }
  });

  it('in PROD with Redis UNCONFIGURED, enforces in-memory rather than 503-ing every turn', async () => {
    const app = authThenBudget(makeBudget('production'));
    expect((await app.request('/think')).status).toBe(200);
    const over = await app.request('/think');
    // The runaway tenant is throttled (429), NOT served a blanket 503 that
    // would break all AI chat when REDIS_URL simply isn't set.
    expect(over.status).toBe(429);
  });
});
