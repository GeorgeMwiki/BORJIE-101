/**
 * Assignment-planner route tests.
 *
 * The route wraps the pure `@borjie/workforce-orchestrator` planAssignment()
 * (no DB reads), so we only mock the auth + database middleware seams and
 * exercise the HTTP surface: auth gate, body validation, and the happy path
 * (risk tier + HITL gate + follow-up cadence returned).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const ctx = (globalThis as any).__BORJIE_TEST_AUTH__;
    if (!ctx) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
    }
    c.set('auth', ctx);
    await next();
  },
}));

vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (c: any, next: any) => {
    c.set('db', (globalThis as any).__BORJIE_TEST_DB__ ?? {});
    c.set('repos', {});
    c.set('useMockData', false);
    await next();
  },
}));

import { Hono } from 'hono';
import { miningAssignmentPlannerRouter } from '../assignment-planner.hono';

const TENANT_ID = 'tenant-001';

function setAuth() {
  (globalThis as any).__BORJIE_TEST_AUTH__ = {
    userId: 'user-mgr',
    tenantId: TENANT_ID,
    role: 'manager',
    permissions: [],
    propertyAccess: ['*'],
  };
}

function clearAuth() {
  (globalThis as any).__BORJIE_TEST_AUTH__ = undefined;
}

function buildApp() {
  const app = new Hono();
  app.route('/', miningAssignmentPlannerRouter);
  return app;
}

function postPlan(app: Hono, body: unknown) {
  return app.request('/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /plan (assignment-planner)', () => {
  beforeEach(() => {
    clearAuth();
  });

  it('401s without auth', async () => {
    const res = await postPlan(buildApp(), {
      title: 't',
      description: 'd',
    });
    expect(res.status).toBe(401);
  });

  it('400s on an invalid body (missing title)', async () => {
    setAuth();
    const res = await postPlan(buildApp(), { description: 'd' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_BODY');
  });

  it('returns a LOW plan with no HITL gate for a routine task', async () => {
    setAuth();
    const res = await postPlan(buildApp(), {
      title: 'sweep the haul road',
      description: 'routine housekeeping',
      nowIso: '2026-06-08T09:00:00.000Z',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        plan: {
          riskTier: string;
          hitlRequired: boolean;
          followups: Array<{ cadenceKind: string }>;
          rationale: { en: string; sw: string };
        };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.plan.riskTier).toBe('LOW');
    expect(body.data.plan.hitlRequired).toBe(false);
    expect(body.data.plan.rationale.en).toContain('LOW');
  });

  it('escalates to SOVEREIGN + HITL on regulator keywords', async () => {
    setAuth();
    const res = await postPlan(buildApp(), {
      title: 'respond to regulator audit',
      description: 'prepare the compliance breach response',
      nowIso: '2026-06-08T09:00:00.000Z',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { plan: { riskTier: string; hitlRequired: boolean } };
    };
    expect(body.data.plan.riskTier).toBe('SOVEREIGN');
    expect(body.data.plan.hitlRequired).toBe(true);
  });
});
